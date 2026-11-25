import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import JSZip from 'jszip';
import { GET, POST as upload } from '../src/app/api/test-case-agent/extensions/route';
import { POST as conversation } from '../src/app/api/test-case-agent/conversation/route';
import { buildMindMap, EMPTY_MAP } from '../src/lib/agent/mindMap';
import { importSkills, resolveSkills } from '../src/lib/agent/skills';
import { collectMaterials } from '../src/lib/agent/materials';
import { importSkillSelection, mergeImportedSkills, planFolderImport } from '../src/components/workspace/skill-upload';

const endpoint = 'http://127.0.0.1/api/test-case-agent/';
const instructions = '---\nname: 测试规范样例\n---\n优先检查显式失败和状态恢复。';
const fixtureCase = {
  id: 'case-a', category: '团队', topic: '邀请后加入', priority: 'P1' as const,
  precondition: '已有邮箱', steps: '1. 接受邀请', expected: '1. 加入团队',
};

function archive(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('imports packaged Skill docs, assigns nested references to the right Skill and ignores scripts', async () => {
  const bundle = await archive({
    'exported/SKILL.md': instructions,
    'exported/GUIDE.md': '先写可观察预期。',
    'exported/references/qa/cases.md': '检查重复提交。',
    'exported/references/another/SKILL.md': '第二组检查规则。',
    'exported/references/another/references/rules.yaml': 'scope: time',
    'exported/scripts/helper.sh': 'ignored command',
    '__MACOSX/._SKILL.md': 'ignored metadata',
  });
  const [main, nested] = await importSkills(bundle);
  assert.equal(main.name, '测试规范样例');
  assert.deepEqual(main.references.map(({ path }) => path), ['GUIDE.md', 'references/qa/cases.md']);
  assert.deepEqual(nested.references.map(({ path }) => path), ['references/rules.yaml']);
  assert.ok(!JSON.stringify([main,nested]).includes('ignored command'));
  assert.deepEqual(await importSkills(bundle), [main, nested]);
});

test('validates missing manifests, traversal and malformed archives', async () => {
  await assert.rejects(importSkills(await archive({ 'README.md': 'guide' })), /没有找到 SKILL/);
  await assert.rejects(importSkills(await archive({ '../SKILL.md': instructions })), /无法解压/);
  await assert.rejects(importSkills(Buffer.from('malformed zip')), /无法解压/);
  const unsupported = await upload(new Request(endpoint, { method: 'POST', body: 'none' }));
  assert.equal(unsupported.status, 415);
  const uploaded = await upload(new Request(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/markdown' }, body: instructions }));
  assert.equal(uploaded.status, 200);
  assert.equal((await uploaded.json()).skills[0].instructions, instructions);
});

test('lists safe MCP metadata and loads only selected MCP and installed Skill IDs', async (t) => {
  const original = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), 'test-cases-extension-'));
  const calls: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    if (request.id === undefined) { res.writeHead(202).end(); return; }
    const result = request.method === 'initialize'
      ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
      : { content: [{ type: 'text', text: '合成资料：撤销后禁止再次接受。' }] };
    if (request.method === 'tools/call') calls.push(request.params.name);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    process.chdir(original);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const template = { type: 'http', url: 'http://127.0.0.1:' + address.port,
    urlArgument: 'url', allowedOrigins: ['https://extensions.example.test'], headers: { Authorization: 'fixture-token' } };
  await writeFile(join(directory,'mcp.json'), JSON.stringify({ mcpServers: {
    primary: { ...template, name: '主需求文档', documentTool: 'read_primary' },
    selected: { ...template, name: '备选设计文档', documentTool: 'read_selected' },
  } }));
  const installed = join(directory, 'skills', 'manual-qa');
  await mkdir(join(installed, 'references'), { recursive: true });
  await writeFile(join(installed, 'SKILL.md'), instructions);
  await writeFile(join(installed, 'references', 'notes.md'), '注意撤销。');
  process.chdir(directory);
  const response = await GET(new Request(endpoint + 'extensions'));
  const catalog = await response.json();
  assert.deepEqual(catalog.mcp, [{ id: 'primary', name: '主需求文档' }, { id: 'selected', name: '备选设计文档' }]);
  assert.deepEqual(catalog.skills, [{ id: 'manual-qa', name: '测试规范样例' }]);
  assert.ok(!JSON.stringify(catalog).includes('fixture-token'));
  const selected = await collectMaterials('https://extensions.example.test/invites', undefined, ['selected']);
  assert.equal(selected.documents.length, 1);
  assert.deepEqual(calls, ['read_selected']);
  await assert.rejects(collectMaterials('https://extensions.example.test/invites', undefined, []), /无法读取/);
  await assert.rejects(collectMaterials('https://extensions.example.test/invites', undefined, ['unknown']), /列表已变化/);
  assert.deepEqual((await resolveSkills(['manual-qa']))[0].references, [{ path: 'references/notes.md', text: '注意撤销。' }]);
  await assert.rejects(resolveSkills(['../manual-qa']), /列表已变化/);
});

test('passes the uploaded Skill text and references to both generation and edit model prompts', async (t) => {
  const originalLoopback = process.env.TEST_CASES_LOOPBACK;
  process.env.TEST_CASES_LOOPBACK = '1';
  const observed: { skills?: { instructions: string; references: { text: string }[] }[]; tree?: unknown }[] = [];
  const gateway = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const { messages } = JSON.parse(text);
    const input = JSON.parse(messages.at(-1).content);
    observed.push(input);
    const followUps = [
      { anchor: '撤销后', text: '撤销后再次打开原邀请，帮我补一条验证无法入团的用例。' },
      { anchor: '用例', text: '可以帮我检查用例的所有覆盖吗？' },
      { anchor: '风控等级', text: '风控等级超过三级时应该拒绝吗？' },
    ];
    const content = input.tree ? { assistantReply: '完成检查。', operations: [], followUps } : { summary: '已生成。', cases: [fixtureCase], followUps };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: input.tree ? { total_tokens: 91 } : { prompt_tokens: 120, completion_tokens: 42, total_tokens: 162 },
    }));
  });
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    if (originalLoopback === undefined) delete process.env.TEST_CASES_LOOPBACK;
    else process.env.TEST_CASES_LOOPBACK = originalLoopback;
    gateway.closeAllConnections();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
  });
  const address = gateway.address();
  assert.ok(address && typeof address === 'object');
  const skills = await importSkills(await archive({
    'qa/SKILL.md': instructions,
    'qa/references/checks.md': '撤销后再次提交属于边界场景。',
  }));
  const output = [];
  for (const tree of [EMPTY_MAP, buildMindMap([fixtureCase])]) {
    const input = {
      messages: [{ role: 'user', content: '邮箱邀请团队，撤销后立即失效。' }],
      currentMindMap: tree,
      extensions: { importedSkills: skills, mcpIds: [] },
      settings: { apiKey: 'fixture-token', baseUrl: 'http://127.0.0.1:' + address.port + '/v1', model: 'fixture' },
    };
    const response = await conversation(new Request(endpoint + 'conversation', { method: 'POST', body: JSON.stringify(input) }));
    assert.equal(response.status, 200);
    output.push(await response.text());
  }
  assert.equal(observed.length, 2);
  assert.ok(observed[1].tree);
  for (const input of observed) {
    assert.equal(input.skills?.[0].instructions, instructions);
    assert.equal(input.skills?.[0].references[0].text, '撤销后再次提交属于边界场景。');
  }
  assert.match(output[0], /载入 Skill/);
  assert.match(output[0], /"type":"complete"/);
  assert.match(output[1], /"type":"edit"/);
  const usage = output.map((stream) => stream.split('\n').filter((line) => line.startsWith('data: {'))
    .map((line) => JSON.parse(line.slice(6))).find((chunk) => chunk.type === 'finish').messageMetadata.execution);
  assert.ok(usage.every(({ elapsedMs }) => Number.isInteger(elapsedMs) && elapsedMs >= 0));
  assert.deepEqual(usage[0].usage, { calls: 1, reported: 1, totalTokens: 162, inputTokens: 120, outputTokens: 42 });
  assert.deepEqual(usage[1].usage, { calls: 1, reported: 1, totalTokens: 91 });
  for (const stream of output) {
    const finish = stream.split('\n').filter((line) => line.startsWith('data: {'))
      .map((line) => JSON.parse(line.slice(6))).find((chunk) => chunk.type === 'finish');
    assert.deepEqual(finish.messageMetadata.followUps, [
      { anchor: '撤销后', text: '撤销后再次打开原邀请，帮我补一条验证无法入团的用例。' },
    ]);
  }
});

test('imports an entire mixed directory and keeps references within the nearest Skill', async (t) => {
  function fixtureFile(path: string, content: string | Uint8Array) {
    const file = new File([typeof content === 'string' ? content : Uint8Array.from(content)], path.split('/').at(-1)!);
    Object.defineProperty(file, 'webkitRelativePath', { value: path });
    return file;
  }
  const packed = await archive({ 'packed/SKILL.md': '---\nname: 已打包\n---\n校验邀请链接。' });
  const files = [
    fixtureFile('混合目录/SKILL.md', '---\nname: 外层\n---\n已选外层规范。'),
    fixtureFile('混合目录/references/outer.md', '外层资料。'),
    fixtureFile('混合目录/references/内层/SKILL.md', '---\nname: 内层\n---\n已选内层规范。'),
    fixtureFile('混合目录/references/内层/references/check.md', '内层资料。'),
    fixtureFile('混合目录/另一个目录/SKILL.md', '---\nname: 单独目录\n---\n校验撤销。'),
    fixtureFile('混合目录/归档/x.skill', packed),
    fixtureFile('混合目录/归档/损坏.zip', '不是压缩包'),
    fixtureFile('混合目录/.git/metadata.zip', '不应发送'),
    fixtureFile('混合目录/截图.png', '不应发送'),
    fixtureFile('混合目录/scripts/script.js', '不应发送'),
  ];
  const tasks = planFolderImport(files);
  assert.equal(tasks.length, 5);
  const uploaded: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, request?: RequestInit) => {
    assert.equal(url, '/api/test-case-agent/extensions');
    assert.ok(request?.body instanceof Blob);
    const input = Buffer.from(await request.body.arrayBuffer());
    try {
      const skills = await importSkills(input);
      uploaded.push(...skills.map(({ name }) => name));
      return Response.json({ skills });
    } catch (cause) {
      return Response.json({ error: (cause as Error).message }, { status: 422 });
    }
  });
  const progress: number[][] = [];
  const result = await importSkillSelection(files, true, (done, total) => progress.push([done, total]));
  assert.deepEqual(uploaded.sort(), ['外层', '内层', '单独目录', '已打包'].sort());
  assert.deepEqual(result.skills.find(({ name }) => name === '外层')?.references, [{ path: 'references/outer.md', text: '外层资料。' }]);
  assert.deepEqual(result.skills.find(({ name }) => name === '内层')?.references, [{ path: 'references/check.md', text: '内层资料。' }]);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].label, /损坏\.zip$/);
  assert.deepEqual(progress.at(-1), [5, 5]);
});

test('imports and enables an entire multi-Skill archive without a selection ceiling', async () => {
  const files = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
    'skill-' + index + '/SKILL.md', '---\nname: 规范 ' + index + '\n---\n测试规则 ',
  ]));
  const skills = await importSkills(await archive(files));
  assert.equal(skills.length, 12);
  const merged = mergeImportedSkills([], [], [...skills, skills[0]]);
  assert.equal(merged.library.length, 12);
  assert.equal(merged.active.length, 12);
  assert.equal(merged.addedCount, 12);
  assert.deepEqual(mergeImportedSkills(merged.library, merged.active, skills).library, merged.library);
});

test('the upload route loads a large manifest and references beyond the former quotas', async () => {
  const instructions = '---\nname: 大规范\n---\n' + '这是一条详细规则。\n'.repeat(9_000);
  const entries = {
    'large/SKILL.md': instructions,
    ...Object.fromEntries(Array.from({ length: 38 }, (_, index) => [
      'large/references/guide-' + index + '.md', ('规则 ' + index + '：核对业务状态。\n').repeat(420),
    ])),
  };
  const zip = await archive(entries);
  const response = await upload(new Request(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: Uint8Array.from(zip),
  }));
  assert.equal(response.status, 200);
  const { skills } = await response.json();
  assert.equal(skills[0].references.length, 38);
  assert.equal(skills[0].instructions, instructions.trim());
});
