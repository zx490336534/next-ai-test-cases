import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { GET as listSessions, PATCH as orderSessions, POST as createSession } from '../src/app/api/test-case-agent/sessions/route';
import { DELETE as deleteSession, GET as getSession, PATCH as renameSession, PUT as saveSession } from '../src/app/api/test-case-agent/sessions/[id]/route';
import { deletedWorkspaceDraft, newWorkspaceWriteId, recoverWorkspaceDraft, workspaceSnapshot, writeWorkspaceDraft } from '../src/components/workspace/workspace-draft';
import { buildCategoryNode, EMPTY_MAP, normalizeMindMap } from '../src/lib/agent/mindMap';
import { validateWorkspaceSave } from '../src/lib/workspaces/validation';
import { openWorkspaceStore, workspaceStore } from '../src/lib/workspaces/store';
import type { WorkspaceSnapshot } from '../src/lib/workspaces/types';

const snapshot: WorkspaceSnapshot = {
  messages: [
    { id: 'question', role: 'user', parts: [{ type: 'text', text: '团队邀请验收' }] },
    { id: 'answer', role: 'assistant', metadata: { followUps: [{ anchor: '邀请', text: '邀请撤销后再次接受时，应核对什么结果？' }], execution: { elapsedMs: 430, usage: { calls: 1, reported: 1, totalTokens: 150 } } }, parts: [
      { type: 'dynamic-tool', toolName: 'workspace_step', toolCallId: 'generate', state: 'output-available', input: { label: '生成用例' }, output: { detail: '1 条用例' } },
      { type: 'text', text: '已生成用例。' },
    ] },
  ],
  mindMap: { ...EMPTY_MAP, children: [{ data: { text: '@邀请模块', uid: 'invites' }, children: [] }] },
};

test('SQLite reopens saved chat and map, lists only the owner’s sessions, and rejects a stale write', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'case-workspaces-store-'));
  const path = join(folder, 'sessions.sqlite');
  let store = openWorkspaceStore(path);
  try {
    const a = store.create('browser-a');
    const b = store.create('browser-a');
    const outside = store.create('browser-b');
    assert.equal(store.save('browser-a', a.id, a.version, snapshot).version, 1);
    assert.throws(() => store.save('browser-a', a.id, a.version, { messages: [], mindMap: EMPTY_MAP }), /其他标签页/);
    store.close();
    store = openWorkspaceStore(path);
    const restored = store.get('browser-a', a.id);
    assert.equal(restored.title, '团队邀请验收');
    assert.deepEqual(restored.messages, snapshot.messages);
    assert.deepEqual(restored.mindMap, snapshot.mindMap);
    assert.deepEqual(store.get('browser-a', b.id).messages, []);
    assert.deepEqual(new Set(store.list('browser-a').map(({ id }) => id)), new Set([a.id, b.id]));
    assert.throws(() => store.get('browser-a', outside.id), /找不到/);
    assert.throws(() => store.save('browser-b', a.id, 1, snapshot), /找不到/);
  } finally {
    store.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test('only replays a tab draft against its original revision or its own acknowledged write', () => {
  const store = openWorkspaceStore(':memory:');
  try {
    const session = store.create('browser-a');
    const writeId = newWorkspaceWriteId();
    assert.match(writeId, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    const draft = { version: session.version, writeIds: [writeId, randomUUID()], snapshot };
    assert.deepEqual(recoverWorkspaceDraft(session, draft), { recovered: draft });
    store.save('browser-a', session.id, session.version, { ...snapshot, writeId });
    const saved = store.get('browser-a', session.id);
    assert.deepEqual(recoverWorkspaceDraft(saved, draft), { recovered: draft });
    assert.deepEqual(recoverWorkspaceDraft(saved, { ...draft, writeIds: [randomUUID()] }).conflict?.snapshot, snapshot);
    store.save('browser-a', session.id, saved.version, snapshot);
    const otherWrite = store.get('browser-a', session.id);
    assert.equal(otherWrite.writeId, undefined);
    assert.deepEqual(recoverWorkspaceDraft(otherWrite, draft), { conflict: draft });
  } finally {
    store.close();
  }
});

test('opening a saved map compares equal to the editor, including freshly created and validated cases', async () => {
  const category = buildCategoryNode('邀请', 'invites', [{
    id: 'case', topic: '接受邀请', category: '邀请', precondition: '无', priority: 'P1', steps: '点击接受', expected: '显示成功',
  }]);
  const { snapshot: saved } = await validateWorkspaceSave({
    version: 0, messages: [], mindMap: { ...EMPTY_MAP, children: [category] },
  });
  for (const persisted of [{ messages: [], mindMap: EMPTY_MAP }, saved]) {
    const initialEditorState = { messages: persisted.messages, mindMap: normalizeMindMap(persisted.mindMap) };
    assert.equal(JSON.stringify(workspaceSnapshot(persisted)), JSON.stringify(initialEditorState));
  }
});

test('a tab can recover a deleted workspace on reload and retry creating its copy', (t) => {
  const items = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  } });
  const store = openWorkspaceStore(':memory:');
  t.after(() => {
    store.close();
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  });
  const original = store.create('profile');
  writeWorkspaceDraft(original.id, { version: 0, snapshot });
  assert.equal(deletedWorkspaceDraft(original.id, store.list('profile')), undefined);
  store.remove('profile', original.id, true);
  assert.throws(() => store.save('profile', original.id, 0, snapshot), /找不到/);
  const recovered = deletedWorkspaceDraft(original.id, store.list('profile'));
  assert.deepEqual(recovered?.messages, snapshot.messages);
  assert.deepEqual(recovered?.mindMap, snapshot.mindMap);
  const copy = { ...snapshot, writeId: newWorkspaceWriteId() };
  const saved = store.create('profile', copy);
  assert.notEqual(saved.id, original.id);
  assert.deepEqual(store.create('profile', copy), saved);
  assert.throws(() => store.create('other owner', copy), /副本已变更/);
  assert.equal(store.list('other owner').length, 0);
  store.save('profile', saved.id, saved.version, { messages: [], mindMap: EMPTY_MAP });
  assert.throws(() => store.create('profile', copy), /副本已变更/);
  writeWorkspaceDraft(original.id);
  assert.equal(deletedWorkspaceDraft(original.id, store.list('profile')), undefined);
});

test('session routes scope persistence to a browser cookie and validate AI SDK messages', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'case-workspaces-http-'));
  const previous = process.env.TEST_CASES_DB_PATH;
  process.env.TEST_CASES_DB_PATH = join(folder, 'sessions.sqlite');
  t.after(async () => {
    workspaceStore().close();
    if (previous === undefined) delete process.env.TEST_CASES_DB_PATH;
    else process.env.TEST_CASES_DB_PATH = previous;
    await rm(folder, { recursive: true, force: true });
  });

  const root = 'http://127.0.0.1:3001/api/test-case-agent/sessions';
  async function cookie() {
    const response = await listSessions(new Request(root));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
    const value = response.headers.get('set-cookie');
    assert.match(value ?? '', /HttpOnly; SameSite=Strict/);
    return value!.split(';')[0];
  }
  const owner = await cookie();
  const stranger = await cookie();
  assert.notEqual(owner, stranger);
  const noCookie = await createSession(new Request(root, { method: 'POST' }));
  assert.equal(noCookie.status, 403);

  const response = await createSession(new Request(root, { method: 'POST', headers: { cookie: owner } }));
  assert.equal(response.status, 201);
  const session = await response.json();
  const context = { params: Promise.resolve({ id: session.id }) };
  const url = root + '/' + session.id;
  const invalid = await saveSession(new Request(url, {
    method: 'PUT', headers: { cookie: owner }, body: JSON.stringify({ version: 0, ...snapshot, messages: [{ parts: [{}] }] }),
  }), context);
  assert.equal(invalid.status, 400);
  const writeId = randomUUID();
  const valid = await saveSession(new Request(url, {
    method: 'PUT', headers: { cookie: owner }, body: JSON.stringify({ version: 0, ...snapshot, writeId, settings: { apiKey: 'fixture-only' } }),
  }), context);
  assert.equal(valid.status, 200);
  const restored = await getSession(new Request(url, { headers: { cookie: owner } }), context);
  const actual = await restored.json();
  assert.equal(actual.title, '团队邀请验收');
  assert.deepEqual(actual.messages, snapshot.messages);
  assert.deepEqual(actual.mindMap, snapshot.mindMap);
  assert.equal(actual.writeId, writeId);
  assert.equal(actual.settings, undefined);
  const foreign = await getSession(new Request(url, { headers: { cookie: stranger } }), context);
  assert.equal(foreign.status, 404);
  const status = await saveSession(new Request(url, {
    method: 'PUT', headers: { cookie: owner }, body: JSON.stringify({ version: 0, ...snapshot }),
  }), context);
  assert.equal(status.status, 409);
  const renamed = await renameSession(new Request(url, {
    method: 'PATCH', headers: { cookie: owner }, body: JSON.stringify({ title: '  人工命名  ' }),
  }), context);
  assert.equal((await renamed.json()).title, '人工命名');
  const newWorkspace = await createSession(new Request(root, { method: 'POST', headers: { cookie: owner } }));
  const targetId = (await newWorkspace.json()).id;
  const reordered = await orderSessions(new Request(root, {
    method: 'PATCH', headers: { cookie: owner }, body: JSON.stringify({ id: session.id, targetId, placement: 'before' }),
  }));
  assert.deepEqual((await reordered.json()).map(({ id }: { id: string }) => id), [session.id, targetId]);

  const foreignDelete = await deleteSession(new Request(url, {
    method: 'DELETE', headers: { cookie: stranger },
  }), context);
  assert.equal(foreignDelete.status, 404);

  const activeDelete = await deleteSession(new Request(url + '?selectNext=1', {
    method: 'DELETE', headers: { cookie: owner },
  }), context);
  assert.equal(activeDelete.status, 200);
  const afterDelete = await activeDelete.json();
  assert.deepEqual(afterDelete.sessions.map(({ id }: { id: string }) => id), [targetId]);
  assert.equal(afterDelete.nextSession.id, targetId);
  const absent = await getSession(new Request(url, { headers: { cookie: owner } }), context);
  assert.equal(absent.status, 404);

  const third = await createSession(new Request(root, { method: 'POST', headers: { cookie: owner } }));
  const thirdId = (await third.json()).id;
  const inactiveDelete = await deleteSession(new Request(root + '/' + thirdId, {
    method: 'DELETE', headers: { cookie: owner },
  }), { params: Promise.resolve({ id: thirdId }) });
  assert.equal((await inactiveDelete.json()).nextSession, null);

  const deleteLast = await deleteSession(new Request(root + '/' + targetId + '?selectNext=1', {
    method: 'DELETE', headers: { cookie: owner },
  }), { params: Promise.resolve({ id: targetId }) });
  const fresh = await deleteLast.json();
  assert.equal(fresh.sessions.length, 1);
  assert.notEqual(fresh.nextSession.id, targetId);
  assert.deepEqual(fresh.nextSession.messages, []);
  assert.deepEqual(fresh.nextSession.mindMap, EMPTY_MAP);

  const copyBody = JSON.stringify({ version: 0, writeId: randomUUID(), ...snapshot });
  const createCopy = (body: string) => createSession(new Request(root, {
    method: 'POST', headers: { cookie: stranger, 'Content-Type': 'application/json' }, body,
  }));
  assert.equal((await createCopy('{}')).status, 400);
  const copied = await (await createCopy(copyBody)).json();
  assert.deepEqual(copied.messages, snapshot.messages);
  assert.deepEqual(copied.mindMap, snapshot.mindMap);
  assert.deepEqual(await (await createCopy(copyBody)).json(), copied);
  const copyHistory = await listSessions(new Request(root, { headers: { cookie: stranger } }));
  assert.deepEqual((await copyHistory.json()).map((item: { id: string }) => item.id), [copied.id]);
});

test('migrates existing SQLite files and preserves manual titles and ordering through autosave', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'case-workspaces-migration-'));
  const path = join(folder, 'sessions.sqlite');
  const original = new DatabaseSync(path);
  original.exec('CREATE TABLE workspaces (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, snapshot TEXT NOT NULL) STRICT;');
  original.prepare('INSERT INTO workspaces (id, owner, title, updated_at, snapshot) VALUES (?, ?, ?, ?, ?)')
    .run('old', 'browser-a', '保留的旧会话', '2026-11-25T02:00:00.000Z', JSON.stringify(snapshot));
  original.close();

  let store = openWorkspaceStore(path);
  try {
    assert.deepEqual(store.get('browser-a', 'old').messages, snapshot.messages);
    const newer = store.create('browser-a');
    const foreign = store.create('browser-b');
    assert.deepEqual(store.list('browser-a').map(({ id }) => id), [newer.id, 'old']);
    assert.deepEqual(store.reorder('browser-a', 'old', newer.id, 'before').map(({ id }) => id), ['old', newer.id]);
    assert.equal(store.rename('browser-a', 'old', '用户自定义名称').title, '用户自定义名称');
    assert.equal(store.save('browser-a', 'old', 0, snapshot).title, '用户自定义名称');
    assert.throws(() => store.reorder('browser-a', 'old', foreign.id, 'after'), /找不到/);
    assert.throws(() => store.rename('browser-b', 'old', '越权'), /找不到/);
    store.close();

    store = openWorkspaceStore(path);
    assert.deepEqual(store.list('browser-a').map(({ id }) => id), ['old', newer.id]);
    assert.equal(store.get('browser-a', 'old').title, '用户自定义名称');
    const latest = store.create('browser-a');
    assert.deepEqual(store.list('browser-a').map(({ id }) => id), [latest.id, 'old', newer.id]);
  } finally {
    store.close();
    await rm(folder, { recursive: true, force: true });
  }
});
