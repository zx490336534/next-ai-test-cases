import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import JSZip from 'jszip';
import { showSuggestedPrompts } from '../src/components/workspace/chat-support';
import { POST as exportXmind } from '../src/app/api/test-case-agent/export-xmind/route';
import { applyEdits, chatAndUpdateMindMap } from '../src/lib/agent/chatEdits';
import { buildMindMap, EMPTY_MAP, normalizeMindMap, readMindMap, toCsv, validateCaseContent } from '../src/lib/agent/mindMap';
import { collectMaterials, materialDigest } from '../src/lib/agent/materials';
import { createModel, type Model } from '../src/lib/agent/model';
import { checkRequestOrigin, resolveModelSettings } from '../src/lib/agent/modelConfig';
import { runGeneration, type GenerationEvent } from '../src/lib/agent/generation';
import type { TestCaseItem } from '../src/lib/agent/types';

const row: TestCaseItem = {
  id: 't', category: '订单', precondition: '已付款', topic: '打开订单', priority: 'P0', steps: '1. 打开订单页', expected: '1. 展示付款金额',
};
const map = buildMindMap([row, { ...row, topic: '余额校验', priority: 'P1' }]);
const rootCases = () => map.children[0].children[0].children;
const snapshot = { requirement: '订单详情展示付款金额。', documents: [], missing: 0 };
const signal = () => new AbortController().signal;
function model(fake: (input: string) => unknown | Promise<unknown>): Model {
  return {
    usage: { calls: 0, reported: 0, inputTokens: 0, outputTokens: 0 },
    async invoke(messages) { return JSON.stringify(await fake(messages.at(-1)?.content ?? '')); },
  };
}

test('normalizes stable IDs and legacy tags without treating ordinary P0-prefixed text as a marker', () => {
  const tree = structuredClone(map);
  const group = tree.children[0].children[0];
  group.data.text = '! 已付款';
  const [first, second] = group.children;
  first.data = { text: '[P0] 打开订单', id: 'legacy' };
  second.data = { text: 'P0状态展示', id: 'legacy' };
  const fixed = normalizeMindMap(tree);
  assert.deepEqual(normalizeMindMap(fixed), fixed);
  const [a, b] = readMindMap(fixed).cases;
  assert.equal(a.topic, '打开订单');
  assert.equal(a.priority, 'P0');
  assert.equal(a.precondition, '已付款');
  assert.equal(b.topic, 'P0状态展示');
  assert.notEqual(a.id, b.id);
});

test('rejects empty, mismatched, misnumbered and placeholder results', () => {
  for (const sample of [
    { ...row, steps: '' }, { ...row, steps: '第一项\n第二项' }, { ...row, expected: '2. 错误编号' },
    { ...row, expected: '1. ' }, { ...row, expected: '1. 符合预期' },
  ]) assert.throws(() => validateCaseContent(sample), /逐条配对/);
  assert.deepEqual(validateCaseContent(row), row);
});

test('applies a scoped batch atomically and protects unrelated nodes', async () => {
  const [a, b] = rootCases();
  const renamed = applyEdits(map, [{ op: 'rename', id: a.data.uid!, text: '查看订单' }]);
  assert.equal(readMindMap(renamed).cases[0].topic, '查看订单');
  assert.deepEqual(renamed.children[0].children[0].children[1], b);
  assert.throws(() => applyEdits(map, [
    { op: 'rename', id: a.data.uid!, text: '第一次修改' }, { op: 'remove', id: 'root' },
  ]));
  assert.equal(readMindMap(map).cases[0].topic, '打开订单');
  const ambiguous = await chatAndUpdateMindMap(model(() => ({ assistantReply: '请指定节点。', operations: [] })),
    { messages: [{ role: 'user', content: '把那个改一下' }], currentMindMap: map });
  assert.equal(ambiguous.mindMap, map);
});

test('keeps successful modules, retries only failed modules, and rejects changed sources', async () => {
  const titles = ['订单', '支付', '账单'];
  let failPayment = true;
  const seen: string[] = [];
  const fake = model((data) => {
    const { targetModule } = JSON.parse(data);
    if (!targetModule) return {
      summary: '三个模块', modules: titles.map((title) => ({ title, id: 'duplicate', description: title, riskPoints: [] })),
    };
    seen.push(targetModule.title);
    if (targetModule.title === '支付' && failPayment) throw new Error();
    return { summary: '完成', cases: [{ ...row, category: targetModule.title }] };
  });
  const events: GenerationEvent[] = [];
  const input = { model: fake, materials: snapshot, concurrency: 2 as const, signal: signal(), emit: (event: GenerationEvent) => events.push(event) };
  await runGeneration(input);
  const plan = events.find((event) => event.type === 'plan')!;
  const failure = events.find((event) => event.type === 'module-error')!;
  assert.deepEqual(events.filter((event) => event.type === 'module').map((event) => event.id).sort(), ['module-1', 'module-3']);
  const retry = { modules: plan.modules, sourceHash: plan.sourceHash, failedIds: [failure.id] };
  failPayment = false;
  seen.length = 0;
  await runGeneration({ ...input, retry });
  assert.deepEqual(seen, ['支付']);
  await assert.rejects(runGeneration({ ...input, retry, materials: { ...snapshot, missing: 1 } }), /资料已变化/);
  assert.equal(plan.sourceHash, materialDigest(snapshot));
});

test('cancellation in the first module stops the rest of a serial run', async () => {
  const abort = new AbortController();
  const calls: string[] = [];
  const fake = model((data) => {
    const { targetModule } = JSON.parse(data);
    if (!targetModule) return { summary: '计划', modules: ['a', 'b'].map((title) => ({ title, id: title, description: '', riskPoints: [] })) };
    calls.push(targetModule.title);
    abort.abort();
    return { summary: '完成', cases: [{ ...row, category: targetModule.title }] };
  });
  await assert.rejects(runGeneration({ model: fake, materials: snapshot, concurrency: 1, signal: abort.signal, emit: () => undefined }), /aborted/);
  assert.deepEqual(calls, ['a']);
});

test('reports missing materials, and rejects a bare unusable URL', async () => {
  await assert.rejects(collectMaterials('请读取需求链接：https://unavailable.fixture.invalid/unavailable'), /无法读取/);
  await assert.rejects(collectMaterials('按资料 https://unavailable.fixture.invalid/locker 验证智能储物柜取件。'), /无法读取/);
  const result = await collectMaterials('https://unavailable.fixture.invalid/unavailable。访客只允许查看摘要，管理员可以导出完整报告。');
  assert.equal(result.missing, 1);
  assert.deepEqual(result.documents, []);
});

test('exports the currently edited tree even when legacy test cases are supplied', async () => {
  const caseId = rootCases()[0].data.uid!;
  const edited = applyEdits(map, [{ op: 'rename', id: caseId, text: '确认订单 & 金额' }, { op: 'priority', id: caseId, priority: 'P2' }]);
  const request = new Request('http://localhost/api/test-case-agent/export-xmind', {
    method: 'POST', body: JSON.stringify({ mindMap: edited, testCases: [row], title: '示例' }),
  });
  const response = await exportXmind(request);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition') ?? '', /UTF-8/);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const file = JSON.parse(await zip.file('content.json')!.async('string'));
  const nodes = file[0].rootTopic.children.attached[0].children.attached[0].children.attached;
  assert.equal(nodes[0].title, '确认订单 & 金额');
  assert.equal(nodes[0].markers[0].markerId, 'priority-3');
  assert.equal(nodes[0].children.attached[0].title, row.steps);
  assert.equal(nodes[0].children.attached[0].children.attached[0].title, row.expected);
  const csv = toCsv(readMindMap(edited).cases);
  assert.match(csv, /确认订单 & 金额","P2/);
  assert.match(csv, /1\. 展示付款金额/);
  assert.match(toCsv([{ ...row, precondition: '=1+1' }]), /"'=1\+1"/);
  const legacy = await exportXmind(new Request(request.url, { method: 'POST', body: JSON.stringify({ mindMap: EMPTY_MAP, testCases: [row] }) }));
  assert.equal(legacy.status, 200);
});

test('restricts key and endpoint binding and refuses foreign request origins', () => {
  const original = { ...process.env };
  delete process.env.TEST_CASES_LOOPBACK;
  try {
    process.env.OPENAI_API_KEY = 'unit-test-key';
    process.env.OPENAI_BASE_URL = 'https://configured.example.test/v1';
    process.env.OPENAI_BASE_URL_ALLOWLIST = 'https://other.example.test/v1/';
    assert.equal(resolveModelSettings().apiKey, 'unit-test-key');
    assert.throws(() => resolveModelSettings({ baseUrl: 'https://other.example.test/v1' }), /API Key/);
    assert.equal(resolveModelSettings({ baseUrl: 'https://other.example.test/v1/', apiKey: 'another-user-key' }).apiKey, 'another-user-key');
    assert.throws(() => resolveModelSettings({ baseUrl: 'http://127.0.0.1/v1', apiKey: 'user-key' }), /未被部署者允许/);
    assert.throws(() => checkRequestOrigin(new Request('https://app.example.test/', { headers: { Origin: 'https://foreign.example.test' } })), /同源/);
    process.env.TEST_CASES_LOOPBACK = '1';
    assert.equal(resolveModelSettings({ baseUrl: 'http://127.0.0.1:3333/v1', apiKey: 'user-key' }).baseUrl, 'http://127.0.0.1:3333/v1');
    assert.throws(() => checkRequestOrigin(new Request('http://127.0.0.1:9300/', { headers: { Host: 'dev.example.test' } })), /回环地址/);
  } finally {
    for (const name of ['TEST_CASES_LOOPBACK', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_BASE_URL_ALLOWLIST']) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
});

test('does not follow model redirects and never reflects upstream error details', async (t) => {
  let redirected = false;
  const server = createServer((request, response) => {
    if (request.url === '/redirect/chat/completions') {
      response.writeHead(307, { Location: '/redirected' }).end();
    } else if (request.url === '/redirected') {
      redirected = true;
      response.end();
    } else {
      response.writeHead(401).end('raw upstream auth error contains a secret');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const host = 'http://127.0.0.1:' + address.port;
  const messages = [{ role: 'user' as const, content: 'test' }];
  await assert.rejects(createModel({ baseUrl: host + '/redirect', model: 'demo', apiKey: 'unit-test-key' }).invoke(messages), /不可达/);
  assert.equal(redirected, false);
  await assert.rejects(createModel({ baseUrl: host, model: 'demo', apiKey: 'unit-test-key' }).invoke(messages), /^Error: 模型网关拒绝认证/);
});

test('reads each approved MCP document once and never calls the gateway for unapproved origins', async (t) => {
  const original = process.cwd();
  const state = await mkdtemp(join(tmpdir(), 'test-cases-mcp-'));
  const received: unknown[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    if (!body.id && body.id !== 0) {
      response.writeHead(202).end();
      return;
    }

    let result: object;
    if (body.method === 'initialize') {
      result = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
    } else {
      received.push(body.params);
      result = { content: [{ type: 'text', text: '报告支持 PDF，访客只能查看摘要。' }] };
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    process.chdir(original);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(state, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = 'https://spec.example.test';
  const documentUrl = origin + '/report';
  await writeFile(join(state, 'mcp.json'), JSON.stringify({
    mcpServers: { fixture: { type: 'http', url: 'http://127.0.0.1:' + address.port, documentTool: 'approved_reader',
      urlArgument: 'document', allowedOrigins: [origin] } },
  }));
  process.chdir(state);
  const result = await collectMaterials('需求：' + documentUrl + ' ' + documentUrl + ' https://elsewhere.example.test/out-of-scope');
  assert.deepEqual(received, [{ name: 'approved_reader', arguments: { document: documentUrl } }]);
  assert.equal(result.missing, 1);
  assert.match(result.documents[0].text, /访客只能查看摘要/);
});

test('shows grounded suggestions and uses the selected test step as the fallback', () => {
  const [selected] = rootCases();
  const known = [{ anchor: '付款金额', text: '付款金额显示为零时，帮我核对这笔订单的可观察结果。' }];
  assert.deepEqual(showSuggestedPrompts(map, selected.data.uid!, known).map(({ text }) => text), [known[0].text]);
  const unrelated = [{ anchor: '退款上限', text: '退款上限需要另外补边界用例吗？' }];
  const local = showSuggestedPrompts(map, selected.children[0].data.uid!, unrelated)[0].text;
  assert.match(local, /打开订单页.*展示付款金额/);
  assert.ok(!local.includes('退款'));
  assert.deepEqual(showSuggestedPrompts(EMPTY_MAP, null), []);
});

test('builds one node per step and nests only its corresponding result', () => {
  const item = { ...row, steps: '1. 打开订单\n2. 点击详情', expected: '1. 展示订单列表\n2. 展示付款金额' };
  const tree = buildMindMap([item]);
  const test = tree.children[0].children[0].children[0];
  assert.deepEqual(test.children.map((step) => [step.data.text, step.children.map((result) => result.data.text)]), [
    ['1. 打开订单', ['1. 展示订单列表']],
    ['2. 点击详情', ['2. 展示付款金额']],
  ]);
  const exported = readMindMap(tree).cases[0];
  assert.equal(exported.steps, item.steps);
  assert.equal(exported.expected, item.expected);
  test.children[0].children = [];
  assert.equal(readMindMap(tree).cases[0].expected, '\n2. 展示付款金额');
});

test('splits paired legacy groups without overwriting ambiguous older details', () => {
  const tree = buildMindMap([row]);
  const test = tree.children[0].children[0].children[0];
  test.children = [{
    data: { text: '测试步骤\n1. 打开订单\n2. 点击详情' },
    children: [{ data: { text: '期望结果\n1. 展示订单列表\n2. 展示付款金额' }, children: [] }],
  }];
  const migrated = normalizeMindMap(tree);
  const steps = migrated.children[0].children[0].children[0].children;
  assert.equal(steps.length, 2);
  assert.equal(steps[1].children[0].data.text, '2. 展示付款金额');
  assert.deepEqual(readMindMap(migrated).cases, readMindMap(tree).cases);
  assert.deepEqual(normalizeMindMap(migrated), migrated);
  test.children[0].children[0].data.text = '期望结果\n2. 展示付款金额';
  const retained = normalizeMindMap(tree);
  assert.equal(retained.children[0].children[0].children[0].children.length, 1);
  assert.equal(readMindMap(retained).cases[0].expected, '2. 展示付款金额');
});
