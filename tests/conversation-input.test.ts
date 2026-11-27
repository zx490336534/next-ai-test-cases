import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverGeneration, rememberGeneration } from '../src/components/workspace/generation-retry';
import { conversationTranscript, type ConversationMessage } from '../src/lib/agent/conversation';
import { conversationSchema, streamConversation } from '../src/lib/agent/conversation-run';
import { maxRequirementLength, requirementSchema } from '../src/lib/agent/contracts';
import { EMPTY_MAP } from '../src/lib/agent/mindMap';
import { checkRequestOrigin } from '../src/lib/agent/modelConfig';

function message(text: string): ConversationMessage {
  return { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }] };
}

test('an oversized historical message stays readable without blocking future requests', () => {
  const atLimit = '测'.repeat(maxRequirementLength);
  assert.equal(requirementSchema.safeParse(atLimit).success, true);
  assert.equal(requirementSchema.safeParse(atLimit + '测').success, false);
  const history = [message(atLimit + '测'), message(atLimit), message('短需求')];
  const transcript = conversationTranscript(history);
  assert.deepEqual(transcript.messages.map(({ content }) => content), [atLimit, '短需求']);
  assert.equal(conversationSchema.safeParse({ ...transcript, currentMindMap: EMPTY_MAP }).success, true);
  assert.equal(history.length, 3);
});

test('a single-pass retry passes the original requirement and selected sources to generation', async (t) => {
  const original = '登录失败须提示密码有误';
  const input = conversationSchema.parse({
    messages: [{ role: 'user', content: '请重试' }], currentMindMap: EMPTY_MAP,
    retry: { requirement: original }, extensions: { mcpIds: ['docs'] },
  });
  let modelRequirement: string | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    modelRequirement = JSON.parse(JSON.parse(String(init.body)).messages[1].content).requirement;
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      summary: '已生成', cases: [{ id: '1', category: '登录', precondition: '已注册', topic: '密码错误',
        priority: 'P1', steps: '输入错误密码', expected: '显示密码错误' }],
    }) } }] });
  });
  const response = streamConversation(input, { baseUrl: 'https://fixture.invalid/v1', model: 'demo', apiKey: 'fixture' },
    new AbortController().signal, {
      readsLinks: true, resolveSkills: async () => [],
      async collectMaterials(requirement, _signal, ids) {
        assert.equal(requirement, original);
        assert.deepEqual(ids, ['docs']);
        return { requirement, documents: [], missing: 0 };
      },
    });
  assert.match(await response.text(), /已生成/);
  assert.equal(modelRequirement, original);
});

test('tab reload restores only the unfinished generation for the matching conversation turn', (t) => {
  const records = new Map<string, string>();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => records.get(key), setItem: (key: string, value: string) => records.set(key, value),
    removeItem: (key: string) => records.delete(key),
  } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  });
  const requirement = '访客无法导出';
  const extensions = { mcpIds: [] };
  const turn = message(requirement);
  const session = { id: 'session', title: '', updatedAt: '', version: 1, mindMap: EMPTY_MAP, messages: [turn] };
  rememberGeneration(session.id, { messageId: turn.id, requirement, extensions });
  assert.deepEqual(recoverGeneration(session), { retry: { requirement }, extensions, errors: [] });
  assert.equal(recoverGeneration({ ...session, messages: [message('新需求')] }), null);
  rememberGeneration(session.id);
  assert.equal(recoverGeneration(session), null);
});

test('normal mode accepts configured external origins and loopback aliases and keeps local mode isolated', (t) => {
  for (const key of ['TEST_CASES_PUBLIC_ORIGIN', 'TEST_CASES_LOOPBACK']) {
    const before = process.env[key];
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  delete process.env.TEST_CASES_LOOPBACK;
  delete process.env.TEST_CASES_PUBLIC_ORIGIN;
  const request = (origin: string, host: string, site = 'same-origin') => new Request('http://localhost:3000/api', {
    headers: { host, origin, 'sec-fetch-site': site },
  });
  assert.doesNotThrow(() => checkRequestOrigin(request('http://127.0.0.1:3000', '127.0.0.1:3000')));
  assert.throws(() => checkRequestOrigin(request('http://127.0.0.1:3100', '127.0.0.1:3000')), /同源/);
  assert.throws(() => checkRequestOrigin(request('https://cases.example.test', 'cases.example.test')), /同源/);
  process.env.TEST_CASES_PUBLIC_ORIGIN = 'https://cases.example.test/';
  assert.doesNotThrow(() => checkRequestOrigin(request('https://cases.example.test', 'proxy:3000')));
  assert.throws(() => checkRequestOrigin(request('https://cases.example.test', 'proxy:3000', 'cross-site')), /同源/);
  assert.throws(() => checkRequestOrigin(request('https://cases.example.test:8443', 'cases.example.test:8443')), /同源/);
  process.env.TEST_CASES_LOOPBACK = '1';
  assert.throws(() => checkRequestOrigin(request('https://cases.example.test', 'cases.example.test')), /回环/);
});
