import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { EMPTY_MAP } from '../src/lib/agent/mindMap';
import type { SavedWorkspace } from '../src/lib/workspaces/types';
import { browserHistory } from '../src/standalone/history';

const databaseName = 'next-ai-test-cases-standalone';
const endpoint = 'https://workspace.invalid/api/test-case-agent/sessions';
const snapshot = {
  messages: [{ id: 'msg', role: 'user' as const, parts: [{ type: 'text' as const, text: '邀请成员' }] }],
  mindMap: { ...EMPTY_MAP, children: [{ data: { text: '@邀请模块', uid: 'module' }, children: [] }] },
};

function waitFor<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function seedLegacy(entries: SavedWorkspace[]) {
  const open = indexedDB.open(databaseName, 1);
  open.onupgradeneeded = () => open.result.createObjectStore('history').put(entries, 'sessions');
  return waitFor(open);
}

async function call(method: string, id?: string, body?: unknown, selectNext = false) {
  const url = endpoint + (id ? '/' + id : '') + (selectNext ? '?selectNext=1' : '');
  const request = new Request(url, { method, ...(body !== undefined && {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) });
  return (await browserHistory(request, id)).json();
}

beforeEach(async () => { await waitFor(indexedDB.deleteDatabase(databaseName)); });

test('migrates v1 custom titles, order, versions and full data; history actions read only summaries', async (t) => {
  const first = { id: crypto.randomUUID(), title: '旧标题', customTitle: '手工命名', updatedAt: '2026-01-01', version: 4, writeId: crypto.randomUUID(), ...snapshot };
  const second = { ...first, id: crypto.randomUUID(), customTitle: '第二条' };
  (await seedLegacy([second, first])).close();
  const list = await call('GET');
  assert.deepEqual(list, [second, first].map((row) => ({ id: row.id, title: row.customTitle, updatedAt: row.updatedAt })));
  const restored = await call('GET', first.id);
  assert.deepEqual(restored, { id: first.id, title: first.customTitle, updatedAt: first.updatedAt, version: first.version, writeId: first.writeId, ...snapshot });

  const get = t.mock.method(IDBObjectStore.prototype, 'get');
  const getAll = t.mock.method(IDBObjectStore.prototype, 'getAll');
  const put = t.mock.method(IDBObjectStore.prototype, 'put');
  await call('GET');
  await call('PATCH', first.id, { title: '重新命名' });
  const order = await call('PATCH', undefined, { id: first.id, targetId: second.id, placement: 'before' });
  assert.deepEqual(order.map((row: { id: string }) => row.id), [first.id, second.id]);
  const changed = await call('PUT', first.id, { ...snapshot, messages: [], version: first.version });
  assert.equal(changed.title, '重新命名');
  assert.equal(changed.version, 5);
  const onSnapshots = (call: { this: unknown }) => call.this instanceof IDBObjectStore && call.this.name === 'snapshots';
  assert.equal(get.mock.calls.filter(onSnapshots).length, 0);
  assert.equal(getAll.mock.calls.filter(onSnapshots).length, 0);
  assert.deepEqual(put.mock.calls.filter(onSnapshots).map((c) => c.arguments[1]), [first.id]);
  assert.deepEqual((await call('GET', second.id)).messages, snapshot.messages);
  assert.equal((await call('GET', first.id)).writeId, undefined);
});

test('a failed upgrade keeps the v1 records and permits a subsequent corrected migration', async () => {
  const first = { id: crypto.randomUUID(), title: '旧会话', updatedAt: '2026-01-01', version: 2, ...snapshot };
  (await seedLegacy([first, first])).close();
  await assert.rejects(call('GET'), { status: 503 });
  const db = await waitFor(indexedDB.open(databaseName, 1));
  assert.deepEqual([...db.objectStoreNames], ['history']);
  const tx = db.transaction('history', 'readwrite');
  const store = tx.objectStore('history');
  assert.deepEqual(await waitFor(store.get('sessions')), [first, first]);
  await waitFor(store.put([first], 'sessions'));
  db.close();
  assert.equal((await call('GET', first.id)).version, 2);
});

test('a blocked upgrade can resume when another tab closes its old database connection', async () => {
  const db = await seedLegacy([]);
  await assert.rejects(call('GET'), /旧版工作台/);
  db.close();
  assert.deepEqual(await call('GET'), []);
  const current = await waitFor(indexedDB.open(databaseName));
  assert.equal(current.version, 2);
  assert.deepEqual([...current.objectStoreNames], ['sessions', 'snapshots']);
  current.close();
});

test('serializes concurrent saves and preserves copy retries, adjacent selection and final replacement', async () => {
  const copy = { ...snapshot, version: 0, writeId: crypto.randomUUID() };
  const [first, replay] = await Promise.all([call('POST', undefined, copy), call('POST', undefined, copy)]);
  assert.deepEqual(replay, first);
  assert.deepEqual((await call('GET')).map((entry: { id: string }) => entry.id), [first.id]);
  const attempts = await Promise.allSettled([
    call('PUT', first.id, { ...snapshot, version: 0 }),
    call('PUT', first.id, { ...snapshot, version: 0, messages: [] }),
  ]);
  assert.equal(attempts.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(attempts.find((entry) => entry.status === 'rejected')?.reason.status, 409);
  await assert.rejects(call('POST', undefined, copy), { status: 409 });
  const second = await call('POST');
  const third = await call('POST');
  assert.equal((await call('DELETE', second.id, undefined, true)).nextSession.id, first.id);
  assert.equal((await call('DELETE', first.id, undefined, true)).nextSession.id, third.id);
  const last = await call('DELETE', third.id, undefined, true);
  assert.deepEqual(last.sessions.map((entry: { id: string }) => entry.id), [last.nextSession.id]);
  assert.deepEqual(last.nextSession.messages, []);
  assert.deepEqual(last.nextSession.mindMap, EMPTY_MAP);
  const empty = await call('DELETE', last.nextSession.id);
  assert.deepEqual(empty, { sessions: [], nextSession: null });
  await assert.rejects(call('GET', last.nextSession.id), { status: 404 });
});
