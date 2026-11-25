import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCaseServer } from '../src/codex/server';
import { createSuiteInput, editSuiteInput, type SuiteView } from '../src/codex/contracts';
import { openCaseStore } from '../src/codex/store';
import { buildMindMap } from '../src/lib/agent/mindMap';

const sample = {
  title: '邀请管理', requirement: '管理员撤销邀请后，链接立即失效。',
  context: '授权在本地测试环境执行。',
  cases: [
    { category: '邀请', priority: 'P0' as const, topic: '已撤销邀请',
      precondition: '存在未接受的邀请', steps: '1. 撤销邀请\n2. 打开邀请', expected: '1. 显示已撤销\n2. 提示链接失效' },
    { category: '邀请', priority: 'P1' as const, topic: '有效邀请',
      precondition: '存在未接受的邀请', steps: '1. 打开邀请', expected: '1. 显示有效邀请' },
  ],
};

test('Codex edits use revisions, stable case IDs, and atomic validation', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'case-plugin-'));
  const dbPath = join(dir, 'suite.sqlite');
  const store = openCaseStore(dbPath);
  const otherChat = openCaseStore(dbPath);
  t.after(async () => {
    otherChat.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const { suite } = store.create(createSuiteInput.parse(sample));
  const id = suite.cases[0].id;
  const edited = store.update(editSuiteInput.parse({
    suiteId: suite.id, revision: suite.revision, details: { title: '团队邀请' },
    changes: [{ action: 'update', caseId: id, entry: { category: '撤销' } }],
  })).suite;
  assert.equal(edited.context, sample.context);
  assert.equal(otherChat.open(suite.id).suite.title, '团队邀请');
  assert.equal(edited.cases[0].id, id);
  assert.equal(buildMindMap(edited.cases, (item) => item.id).children[0].children[0].children[0].data.uid, id);
  assert.throws(() => otherChat.update({
    suiteId: suite.id, revision: suite.revision, details: { title: '过期编辑' }, changes: [],
  }), /已修改/);
  assert.throws(() => store.update({
    suiteId: suite.id, revision: edited.revision, details: { title: '不可提交' },
    changes: [{ action: 'update', caseId: id, entry: { expected: '符合预期' } }],
  }), /逐条配对/);
  assert.deepEqual(store.open(suite.id).suite, edited);
});

test('Codex execution records freeze the chosen subset and guard evidence across edits', (t) => {
  const store = openCaseStore(':memory:');
  t.after(store.close);
  const { suite } = store.create(sample);
  const { run } = store.startRun({
    suiteId: suite.id, revision: 1, caseIds: [suite.cases[0].id], target: '本机示例应用',
  });
  assert.deepEqual(run.cases, [suite.cases[0]]);
  assert.equal(run.context, suite.context);
  store.update({
    suiteId: suite.id, revision: 1, details: { context: '后续环境' },
    changes: [{ action: 'update', caseId: suite.cases[0].id, entry: { topic: '后续修改' } }],
  });
  assert.deepEqual(store.getRun(suite.id, run.id), run);
  assert.throws(() => store.startRun({
    suiteId: suite.id, revision: 1, caseIds: [suite.cases[0].id], target: '本机示例应用',
  }), /已修改/);
  const pass = { caseId: suite.cases[0].id, status: 'passed' as const, evidence: '取消后再打开链接，显示已失效。' };
  assert.throws(() => store.record({
    suiteId: suite.id, runId: run.id,
    outcomes: [pass, { ...pass, caseId: suite.cases[1].id }],
  }), /本批次/);
  assert.equal(store.getRun(suite.id, run.id).outcomes.length, 0);
  assert.throws(() => store.getRun(randomUUID(), run.id), /找不到/);
  const processed = store.record({ suiteId: suite.id, runId: run.id, outcomes: [pass] });
  assert.deepEqual(store.record({ suiteId: suite.id, runId: run.id, outcomes: [pass] }), processed);
  assert.throws(() => store.record({ suiteId: suite.id, runId: run.id,
    outcomes: [{ ...pass, status: 'failed' }],
  }), /复测/);
  assert.deepEqual(store.open(suite.id).lastRun, processed);
});

test('MCP tools expose a board resource and persist a generated suite', async (t) => {
  const store = openCaseStore(':memory:');
  const server = createCaseServer(store, '<!doctype html><title>测试用例</title>');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); store.close(); });
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(({ name }) => name).sort(), [
    'create_suite', 'get_run', 'list_suites', 'open_suite', 'record_run_results', 'start_run', 'update_suite',
  ]);
  const meta = tools.find(({ name }) => name === 'open_suite')?._meta as { ui: { resourceUri: string } };
  assert.equal(meta.ui.resourceUri, 'ui://test-case-workbench/board.html');
  const resource = (await client.readResource({ uri: meta.ui.resourceUri })).contents[0];
  assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
  const created = await client.callTool({ name: 'create_suite', arguments: sample });
  assert.equal(created.isError, undefined);
  const { suite } = created.structuredContent as SuiteView;
  assert.equal(suite.title, sample.title);
  const opened = await client.callTool({ name: 'open_suite', arguments: { suiteId: suite.id } });
  assert.deepEqual(opened.structuredContent, created.structuredContent);
});
