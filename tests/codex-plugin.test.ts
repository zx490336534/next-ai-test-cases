import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { writeBoardFile } from '../src/codex/board-file';
import { boardSelection, setCasesChecked } from '../src/codex/case-selection';
import { createCaseServer } from '../src/codex/server';
import { createSuiteInput, editSuiteInput, recordRunInput, startRunInput, type SuiteView } from '../src/codex/contracts';
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

test('filtered case selection affects visible matches and preserves choices from other filters', () => {
  const [revoked, valid, hidden] = [{ id: 'revoked' }, { id: 'valid' }, { id: 'hidden' }];
  const selected = setCasesChecked(new Set(), [revoked], true);
  assert.deepEqual([...selected], ['revoked']);
  const both = setCasesChecked(selected, [valid], true);
  assert.deepEqual([...both], ['revoked', 'valid']);
  assert.deepEqual(setCasesChecked(both, [revoked, valid], true), both);
  assert.deepEqual([...setCasesChecked(both, [valid, hidden], false)], ['revoked']);
  assert.deepEqual(setCasesChecked(both, [], false), both);
});

test('a refreshed board keeps only cases whose steps and execution context the user selected', (t) => {
  const store = openCaseStore(':memory:');
  t.after(store.close);
  const view = store.create(sample);
  const [changed, unchanged] = view.suite.cases;
  const checked = boardSelection({ view, selectedIds: new Set(), selectionNotice: '' },
    { type: 'check', cases: view.suite.cases, checked: true });
  const updated = store.update({
    suiteId: view.suite.id, revision: view.suite.revision,
    changes: [{ action: 'update', caseId: changed.id, entry: { steps: '1. 发布草稿', expected: '1. 显示已发布' } }],
  });
  const refreshed = boardSelection(checked, { type: 'view', view: updated });
  assert.deepEqual([...refreshed.selectedIds], [unchanged.id]);
  assert.match(refreshed.selectionNotice, /取消勾选 1 条/);
  assert.equal(boardSelection(refreshed, { type: 'view', view }), refreshed);
  const confirmed = boardSelection(refreshed, { type: 'check', cases: [updated.suite.cases[0]], checked: true });
  assert.equal(confirmed.selectedIds.size, 2);
  assert.equal(confirmed.selectionNotice, '');
  const moved = store.update({
    suiteId: view.suite.id, revision: updated.suite.revision, changes: [], details: { context: '更换验收环境' },
  });
  const newContext = boardSelection(confirmed, { type: 'view', view: moved });
  assert.equal(newContext.selectedIds.size, 0);
  assert.match(newContext.selectionNotice, /执行上下文/);
});

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

test('large workspaces can be created, appended and run without a case-count ceiling', (t) => {
  const store = openCaseStore(':memory:');
  t.after(store.close);
  const cases = Array.from({ length: 121 }, (_, index) => ({ ...sample.cases[0], topic: '用例 ' + index }));
  const { suite } = store.create(createSuiteInput.parse({ ...sample, cases }));
  const { suite: updated } = store.update(editSuiteInput.parse({
    suiteId: suite.id, revision: suite.revision,
    changes: cases.map((entry) => ({ action: 'add', entry: { ...entry, topic: entry.topic + ' 新增' } })),
  }));
  assert.equal(updated.cases.length, 242);
  const caseIds = updated.cases.map(({ id }) => id);
  const { run } = store.startRun(startRunInput.parse({
    suiteId: suite.id, revision: updated.revision, caseIds, target: '本地存储边界验收',
  }));
  assert.equal(run.cases.length, 242);
  const recorded = store.record(recordRunInput.parse({
    suiteId: suite.id, runId: run.id,
    outcomes: caseIds.map((caseId) => ({ caseId, status: 'skipped', evidence: '用于验证批量记录。' })),
  }));
  assert.equal(recorded.outcomes.length, 242);
});

test('MCP tools expose a board resource and persist a generated suite', async (t) => {
  const store = openCaseStore(':memory:');
  const directory = await mkdtemp(join(tmpdir(), 'case-board-'));
  const boardHtml = '<!doctype html><body><div id="root"></div></body>';
  const server = createCaseServer(store, boardHtml);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(({ name }) => name).sort(), [
    'append_cases', 'create_suite', 'get_run', 'list_suites', 'open_suite', 'record_run_results', 'start_run', 'update_suite', 'workbench_panel',
  ]);
  const meta = tools.find(({ name }) => name === 'open_suite')?._meta as { ui: { resourceUri: string } };
  assert.equal(meta.ui.resourceUri, 'ui://test-case-workbench/board.html');
  const resource = (await client.readResource({ uri: meta.ui.resourceUri })).contents[0];
  assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
  const title = '邀请管理 </script><script>throw 0</script>';
  const created = await client.callTool({ name: 'create_suite', arguments: { ...sample, title } });
  assert.equal(created.isError, undefined);
  const { suite } = created.structuredContent as SuiteView;
  assert.equal(suite.title, title);
  const opened = await client.callTool({ name: 'open_suite', arguments: { suiteId: suite.id } });
  const content = opened.structuredContent as SuiteView;
  assert.deepEqual(content.suite, suite);
  const boardPath = writeBoardFile(directory, boardHtml, content);
  assert.equal(boardPath, join(directory, suite.id + '.html'));
  const file = await readFile(boardPath, 'utf8');
  assert.ok(!file.includes(title));
  const data = file.match(/<script id="test-case-workbench-data" type="application\/json">([^]*?)<\/script>/)?.[1];
  assert.ok(data);
  assert.deepEqual(JSON.parse(data), created.structuredContent);
  assert.equal(tools.find(({ name }) => name === 'append_cases')?.annotations?.destructiveHint, false);
  const appended = await client.callTool({
    name: 'append_cases', arguments: { suiteId: suite.id, revision: suite.revision, cases: sample.cases },
  });
  assert.deepEqual(appended.structuredContent, { suiteId: suite.id, revision: 2, count: 4 });
  const caseIds = suite.cases.map(({ id }) => id);
  const started = await client.callTool({
    name: 'start_run', arguments: { suiteId: suite.id, revision: 2, caseIds, target: '测试环境' },
  });
  const { run } = started.structuredContent as { run: { id: string } };
  const ids = { suiteId: suite.id, runId: run.id };
  const evidence = { caseId: caseIds[0], status: 'passed', evidence: '已显示链接失效。' };
  for (const outcomes of [[evidence, evidence], [evidence]]) {
    const receipt = await client.callTool({ name: 'record_run_results', arguments: { ...ids, outcomes } });
    assert.deepEqual(receipt.structuredContent, { ...ids, caseIds: [caseIds[0]], recorded: 1, total: 2 });
  }
  const recovered = await client.callTool({ name: 'get_run', arguments: ids });
  const stored = (recovered.structuredContent as { run: { cases: unknown[]; outcomes: unknown[] } }).run;
  assert.deepEqual(stored.cases, suite.cases);
  assert.deepEqual(stored.outcomes, [evidence]);
  const panel = tools.find(({ name }) => name === 'workbench_panel');
  assert.equal(panel?.title, '测试用例脑图');
  assert.deepEqual(panel?._meta?.['openai/ui'], { entrypoints: [{ type: 'thread' }] });
  assert.deepEqual(panel?._meta?.ui, { resourceUri: meta.ui.resourceUri, visibility: ['app'] });
  const initial = await client.callTool({ name: 'workbench_panel' });
  const suites = (initial.structuredContent as { suites: { id: string; count: number }[] }).suites;
  assert.equal(suites[0].id, suite.id);
  assert.equal(suites[0].count, 4);
});
