import { EMPTY_MAP } from '@/lib/agent/mindMap';
import { parseJson, RequestError } from '@/lib/agent/modelConfig';
import { titleFor } from '@/lib/workspaces/title';
import type { RemovedWorkspace, SavedWorkspace, WorkspaceSummary, WorkspaceWrite } from '@/lib/workspaces/types';
import { renameSchema, reorderSchema, validateWorkspaceSave } from '@/lib/workspaces/validation';

type LegacyEntry = SavedWorkspace & { customTitle?: string };
type SessionHeader = WorkspaceSummary & { customTitle?: string; version: number; position: number };
type Stores = { headers: IDBObjectStore; snapshots: IDBObjectStore };

function summary({ id, title, customTitle, updatedAt }: SessionHeader): WorkspaceSummary {
  return { id, title: customTitle ?? title, updatedAt };
}

function storageError() {
  return new RequestError('浏览器无法保存或读取会话，请检查存储权限和剩余空间。', 503);
}

function notFound() {
  return new RequestError('找不到这个会话', 404);
}

function resultOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError());
  });
}

let connection: Promise<IDBDatabase> | undefined;

function openHistory() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('next-ai-test-cases-standalone', 2);
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new RequestError('请关闭仍在使用旧版工作台的其他标签页，然后重试。', 503));
    };
    request.onupgradeneeded = ({ oldVersion }) => {
      const db = request.result;
      const headers = db.createObjectStore('sessions', { keyPath: 'id' });
      headers.createIndex('position', 'position');
      const snapshots = db.createObjectStore('snapshots');
      if (oldVersion === 1) {
        const tx = request.transaction!;
        const legacy = tx.objectStore('history').get('sessions');
        legacy.onsuccess = () => {
          const entries: LegacyEntry[] = legacy.result ?? [];
          entries.forEach(({ messages, mindMap, writeId, ...header }, position) => {
            headers.add({ ...header, position });
            snapshots.add({ messages, mindMap, ...(writeId && { writeId }) }, header.id);
          });
          // The old store and all migrated records commit (or roll back) together.
          db.deleteObjectStore('history');
        };
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => {
        db.close();
        connection = undefined;
      };
      resolve(db);
    };
    request.onerror = () => reject(storageError());
  }).catch((error) => {
    connection = undefined;
    throw error instanceof RequestError ? error : storageError();
  });
}

async function inHistory<T>(signal: AbortSignal, mode: IDBTransactionMode, action: (stores: Stores) => Promise<T>): Promise<T> {
  const db = await openHistory();
  signal.throwIfAborted();
  const tx = db.transaction(['sessions', 'snapshots'], mode);
  const completed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(signal.aborted ? signal.reason : storageError());
  });
  const abort = () => {
    try { tx.abort(); } catch { /* The transaction may already have finished. */ }
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const [result] = await Promise.all([
      action({ headers: tx.objectStore('sessions'), snapshots: tx.objectStore('snapshots') }),
      completed,
    ]);
    return result;
  } catch (error) {
    abort();
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function orderedHeaders(headers: IDBObjectStore): Promise<SessionHeader[]> {
  return resultOf(headers.index('position').getAll());
}

async function savedSession(stores: Stores, header: SessionHeader): Promise<SavedWorkspace> {
  const snapshot: WorkspaceWrite | undefined = await resultOf(stores.snapshots.get(header.id));
  if (!snapshot) throw storageError();
  return { ...summary(header), version: header.version, ...snapshot };
}

async function createSession(stores: Stores, snapshot: WorkspaceWrite = { messages: [], mindMap: EMPTY_MAP }): Promise<SavedWorkspace> {
  const id = snapshot.writeId ?? crypto.randomUUID();
  if (snapshot.writeId) {
    const previous: SessionHeader | undefined = await resultOf(stores.headers.get(id));
    if (previous) {
      const saved = await savedSession(stores, previous);
      if (saved.writeId === snapshot.writeId
        && JSON.stringify(saved.messages) === JSON.stringify(snapshot.messages)
        && JSON.stringify(saved.mindMap) === JSON.stringify(snapshot.mindMap)) return saved;
      throw new RequestError('副本已变更，请重试以另存新会话。', 409);
    }
  }
  const first = await resultOf(stores.headers.index('position').openKeyCursor());
  const header: SessionHeader = {
    id, title: titleFor(snapshot), updatedAt: new Date().toISOString(), version: 0,
    position: first ? Number(first.key) - 1 : 0,
  };
  stores.headers.add(header);
  stores.snapshots.add(snapshot, id);
  return { ...summary(header), version: header.version, ...snapshot };
}

export async function browserHistory(request: Request, id?: string) {
  const { method, signal } = request;
  if (method === 'GET' && !id) {
    return Response.json(await inHistory(signal, 'readonly', async ({ headers }) => (await orderedHeaders(headers)).map(summary)));
  }
  if (method === 'POST' && !id) {
    const change = request.headers.get('content-type')?.startsWith('application/json')
      ? await validateWorkspaceSave(await request.json().catch(() => null)) : undefined;
    const session = await inHistory(signal, 'readwrite', (stores) => createSession(stores, change?.snapshot));
    return Response.json(session, { status: 201 });
  }
  if (method === 'PATCH' && !id) {
    const { id: movingId, targetId, placement } = await parseJson(request, reorderSchema);
    const reordered = await inHistory(signal, 'readwrite', async ({ headers }) => {
      const rows = await orderedHeaders(headers);
      const moving = rows.findIndex((entry) => entry.id === movingId);
      if (moving < 0 || !rows.some((entry) => entry.id === targetId)) throw notFound();
      if (movingId !== targetId) {
        const positions = rows.map((entry) => entry.position);
        const [row] = rows.splice(moving, 1);
        const target = rows.findIndex((entry) => entry.id === targetId);
        rows.splice(target + (placement === 'after' ? 1 : 0), 0, row);
        rows.forEach((entry, index) => {
          if (entry.position !== positions[index]) headers.put({ ...entry, position: positions[index] });
        });
      }
      return rows.map(summary);
    });
    return Response.json(reordered);
  }

  if (!id) throw new RequestError('不支持的会话操作', 405);
  const change = method === 'PUT' ? await validateWorkspaceSave(await request.json().catch(() => null)) : undefined;
  const rename = method === 'PATCH' ? await parseJson(request, renameSchema) : undefined;
  const response = await inHistory(signal, method === 'GET' ? 'readonly' : 'readwrite', async (stores) => {
    const entry: SessionHeader | undefined = await resultOf(stores.headers.get(id));
    if (!entry) throw notFound();
    if (method === 'GET') return savedSession(stores, entry);
    if (change) {
      if (entry.version !== change.version) throw new RequestError('此会话已在其他标签页更新。请刷新后继续。', 409);
      const next = { ...entry, title: titleFor(change.snapshot), version: entry.version + 1, updatedAt: new Date().toISOString() };
      stores.headers.put(next);
      stores.snapshots.put(change.snapshot, id);
      return { ...summary(next), version: next.version };
    }
    if (rename) {
      const next = { ...entry, customTitle: rename.title, updatedAt: new Date().toISOString() };
      stores.headers.put(next);
      return summary(next);
    }
    if (method === 'DELETE') {
      stores.headers.delete(id);
      stores.snapshots.delete(id);
      const rows = await orderedHeaders(stores.headers);
      const sessions = rows.map(summary);
      let nextSession: SavedWorkspace | null = null;
      if (new URL(request.url).searchParams.get('selectNext') === '1') {
        const adjacent = rows.find((row) => row.position > entry.position) ?? rows.at(-1);
        nextSession = adjacent ? await savedSession(stores, adjacent) : await createSession(stores);
        if (!adjacent) sessions.push({ id: nextSession.id, title: nextSession.title, updatedAt: nextSession.updatedAt });
      }
      return { sessions, nextSession } satisfies RemovedWorkspace;
    }
    throw new RequestError('不支持的会话操作', 405);
  });
  return Response.json(response);
}
