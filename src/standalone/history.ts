import { EMPTY_MAP } from '@/lib/agent/mindMap';
import { parseJson, RequestError } from '@/lib/agent/modelConfig';
import { titleFor } from '@/lib/workspaces/title';
import type { RemovedWorkspace, SavedWorkspace, WorkspaceSummary, WorkspaceWrite } from '@/lib/workspaces/types';
import { renameSchema, reorderSchema, validateWorkspaceSave } from '@/lib/workspaces/validation';

type Entry = SavedWorkspace & { customTitle?: string };

function summary({ id, title, updatedAt, customTitle }: Entry): WorkspaceSummary {
  return { id, title: customTitle ?? title, updatedAt };
}

function saved({ customTitle, ...session }: Entry): SavedWorkspace {
  return { ...session, title: customTitle ?? session.title };
}

function newSession(snapshot: WorkspaceWrite = { messages: [], mindMap: EMPTY_MAP }): Entry {
  return {
    id: snapshot.writeId ?? crypto.randomUUID(), title: titleFor(snapshot), updatedAt: new Date().toISOString(),
    version: 0, ...snapshot,
  };
}

let connection: Promise<IDBDatabase> | undefined;

function openHistory() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('next-ai-test-cases-standalone', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('history'); };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        connection = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  }).catch(() => {
    connection = undefined;
    throw new RequestError('浏览器无法打开会话存储，请允许本地存储，或在普通浏览窗口打开此文件。', 503);
  });
}

async function readHistory<T>(write: boolean, signal: AbortSignal, action: (sessions: Entry[]) => T): Promise<T> {
  const database = await openHistory();
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('history', write ? 'readwrite' : 'readonly');
    const store = transaction.objectStore('history');
    const request = store.get('sessions');
    let result: T;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        signal.throwIfAborted();
        const sessions: Entry[] = request.result ?? [];
        result = action(sessions);
        if (write) store.put(sessions, 'sessions');
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(failure ?? new RequestError('浏览器无法保存或读取会话，请检查存储权限和剩余空间。', 503));
  });
}

export async function browserHistory(request: Request, id?: string) {
  const { method, signal } = request;
  if (method === 'GET' && !id) {
    return Response.json(await readHistory(false, signal, (sessions) => sessions.map(summary)));
  }
  if (method === 'POST' && !id) {
    const change = request.headers.get('content-type')?.startsWith('application/json')
      ? await validateWorkspaceSave(await request.json().catch(() => null)) : undefined;
    const session = await readHistory(true, signal, (sessions) => {
      const entry = newSession(change?.snapshot);
      const previous = sessions.find((row) => row.id === entry.id);
      if (previous) {
        if (previous.writeId === entry.writeId
          && JSON.stringify(previous.messages) === JSON.stringify(entry.messages)
          && JSON.stringify(previous.mindMap) === JSON.stringify(entry.mindMap)) return saved(previous);
        throw new RequestError('副本已变更，请重试以另存新会话。', 409);
      }
      sessions.unshift(entry);
      return saved(entry);
    });
    return Response.json(session, { status: 201 });
  }
  if (method === 'PATCH' && !id) {
    const { id: movingId, targetId, placement } = await parseJson(request, reorderSchema);
    const reordered = await readHistory(true, signal, (sessions) => {
      const index = sessions.findIndex((entry) => entry.id === movingId);
      if (index === -1 || !sessions.some((entry) => entry.id === targetId)) throw new RequestError('找不到这个会话', 404);
      if (movingId !== targetId) {
        const [moving] = sessions.splice(index, 1);
        const targetIndex = sessions.findIndex((entry) => entry.id === targetId);
        sessions.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, moving);
      }
      return sessions.map(summary);
    });
    return Response.json(reordered);
  }

  const change = method === 'PUT' ? await validateWorkspaceSave(await request.json().catch(() => null)) : undefined;
  const rename = method === 'PATCH' ? await parseJson(request, renameSchema) : undefined;
  const response = await readHistory(method !== 'GET', signal, (sessions) => {
    const index = sessions.findIndex((entry) => entry.id === id);
    if (index === -1) throw new RequestError('找不到这个会话', 404);
    const entry = sessions[index];
    if (method === 'GET') return saved(entry);
    if (change) {
      if (entry.version !== change.version) throw new RequestError('此会话已在其他标签页更新。请刷新后继续。', 409);
      const next = {
        ...entry, ...change.snapshot, writeId: change.snapshot.writeId, title: titleFor(change.snapshot),
        version: entry.version + 1, updatedAt: new Date().toISOString(),
      };
      sessions[index] = next;
      return { ...summary(next), version: next.version };
    }
    if (rename) {
      const next = { ...entry, customTitle: rename.title, updatedAt: new Date().toISOString() };
      sessions[index] = next;
      return summary(next);
    }
    if (method === 'DELETE') {
      sessions.splice(index, 1);
      const selectNext = new URL(request.url).searchParams.get('selectNext') === '1';
      if (selectNext && !sessions.length) sessions.push(newSession());
      const next = selectNext ? sessions[Math.min(index, sessions.length - 1)] : undefined;
      return { sessions: sessions.map(summary), nextSession: next ? saved(next) : null } satisfies RemovedWorkspace;
    }
    throw new RequestError('不支持的会话操作', 405);
  });
  return Response.json(response);
}
