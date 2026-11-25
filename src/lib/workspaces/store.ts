import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { titleFor } from './title';
import { EMPTY_MAP } from '@/lib/agent/mindMap';
import { RequestError } from '@/lib/agent/modelConfig';
import type { SavedWorkspace, WorkspaceSnapshot, WorkspaceSummary } from './types';

export function openWorkspaceStore(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(path);
  database.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');

  function transaction<T>(action: () => T): T {
    database.exec('BEGIN IMMEDIATE;');
    try {
      const result = action();
      database.exec('COMMIT;');
      return result;
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  transaction(() => {
    database.exec(
      'CREATE TABLE IF NOT EXISTS workspaces (' +
      ' id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, updated_at TEXT NOT NULL,' +
      ' version INTEGER NOT NULL DEFAULT 0, snapshot TEXT NOT NULL,' +
      ' custom_title TEXT, position INTEGER NOT NULL DEFAULT 0' +
      ') STRICT;',
    );
    const columns = new Set(database.prepare('PRAGMA table_info(workspaces)').all().map(({ name }) => name));
    if (!columns.has('custom_title')) database.exec('ALTER TABLE workspaces ADD COLUMN custom_title TEXT;');
    if (!columns.has('position')) database.exec('ALTER TABLE workspaces ADD COLUMN position INTEGER NOT NULL DEFAULT 0;');
    database.exec('CREATE INDEX IF NOT EXISTS workspaces_owner_order ON workspaces(owner, position DESC, updated_at DESC, id DESC);');
  });

  const summaryColumns = 'id, COALESCE(custom_title, title) AS title, updated_at AS updatedAt';
  const list = database.prepare('SELECT ' + summaryColumns + ' FROM workspaces WHERE owner = ? ORDER BY position DESC, updated_at DESC, id DESC');
  const get = database.prepare('SELECT ' + summaryColumns + ', version, snapshot FROM workspaces WHERE owner = ? AND id = ?');
  const insert = database.prepare(
    'INSERT INTO workspaces (id, owner, title, updated_at, snapshot, position)' +
    ' SELECT ?, ?, ?, ?, ?, COALESCE(MAX(position), 0) + 1 FROM workspaces WHERE owner = ?',
  );
  const update = database.prepare(
    'UPDATE workspaces SET title = ?, updated_at = ?, snapshot = ?, version = version + 1' +
    ' WHERE owner = ? AND id = ? AND version = ? RETURNING ' + summaryColumns + ', version',
  );
  const rename = database.prepare('UPDATE workspaces SET custom_title = ?, updated_at = ? WHERE owner = ? AND id = ? RETURNING ' + summaryColumns);
  const setPosition = database.prepare('UPDATE workspaces SET position = ? WHERE owner = ? AND id = ?');
  const deleteOne = database.prepare('DELETE FROM workspaces WHERE owner = ? AND id = ?');

  function getSession(owner: string, id: string): SavedWorkspace {
    const row = get.get(owner, id) as (WorkspaceSummary & { version: number; snapshot: string }) | undefined;
    if (!row) throw new RequestError('找不到这个会话', 404);
    const { snapshot, ...summary } = row;
    return { ...summary, ...JSON.parse(snapshot) as WorkspaceSnapshot };
  }

  function createSession(owner: string): SavedWorkspace {
    const snapshot: WorkspaceSnapshot = { messages: [], mindMap: EMPTY_MAP };
    const result = { id: randomUUID(), title: '新会话', updatedAt: new Date().toISOString(), version: 0 };
    insert.run(result.id, owner, result.title, result.updatedAt, JSON.stringify(snapshot), owner);
    return { ...result, ...snapshot };
  }

  return {
    list(owner: string) {
      return list.all(owner) as WorkspaceSummary[];
    },
    get: getSession,
    create: createSession,
    save(owner: string, id: string, version: number, snapshot: WorkspaceSnapshot) {
      const result = update.get(titleFor(snapshot), new Date().toISOString(), JSON.stringify(snapshot), owner, id, version);
      if (result) return result as WorkspaceSummary & { version: number };
      if (!get.get(owner, id)) throw new RequestError('找不到这个会话', 404);
      throw new RequestError('此会话已在其他标签页更新。请刷新后继续。', 409);
    },
    rename(owner: string, id: string, title: string) {
      const result = rename.get(title, new Date().toISOString(), owner, id) as WorkspaceSummary | undefined;
      if (!result) throw new RequestError('找不到这个会话', 404);
      return result;
    },
    reorder(owner: string, id: string, targetId: string, placement: 'before' | 'after') {
      return transaction(() => {
        const ordered = list.all(owner) as WorkspaceSummary[];
        const moving = ordered.find((item) => item.id === id);
        if (!moving || !ordered.some((item) => item.id === targetId)) throw new RequestError('找不到这个会话', 404);
        if (id === targetId) return ordered;
        const remaining = ordered.filter((item) => item.id !== id);
        const targetIndex = remaining.findIndex((item) => item.id === targetId);
        remaining.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, moving);
        remaining.forEach((item, index) => setPosition.run(remaining.length - index, owner, item.id));
        return remaining;
      });
    },
    remove(owner: string, id: string, selectNext: boolean) {
      return transaction(() => {
        const ordered = list.all(owner) as WorkspaceSummary[];
        const index = ordered.findIndex((item) => item.id === id);
        if (index === -1) throw new RequestError('找不到这个会话', 404);
        deleteOne.run(owner, id);
        ordered.splice(index, 1);
        if (!selectNext) return { sessions: ordered, nextSession: null };
        const adjacent = ordered[Math.min(index, ordered.length - 1)];
        const nextSession = adjacent ? getSession(owner, adjacent.id) : createSession(owner);
        if (!adjacent) ordered.push({ id: nextSession.id, title: nextSession.title, updatedAt: nextSession.updatedAt });
        return { sessions: ordered, nextSession };
      });
    },
    close: () => database.close(),
  };
}

let store: ReturnType<typeof openWorkspaceStore> | undefined;

export function workspaceStore() {
  const path = process.env.TEST_CASES_DB_PATH || '.data/conversations.sqlite';
  return store ??= openWorkspaceStore(resolve(/* turbopackIgnore: true */ path));
}
