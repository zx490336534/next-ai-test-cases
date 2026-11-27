import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, cp, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

test('evaluation resumes successful trials only for the same inputs and retains earlier reports', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'case-evaluation-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const root = fileURLToPath(new URL('..', import.meta.url));
  await Promise.all([
    cp(join(root, 'src/lib'), join(cwd, 'src/lib'), { recursive: true }),
    cp(join(root, 'eval'), join(cwd, 'eval'), { recursive: true }),
    cp(join(root, 'pnpm-lock.yaml'), join(cwd, 'pnpm-lock.yaml')),
    symlink(join(root, 'node_modules'), join(cwd, 'node_modules'), 'junction'),
  ]);
  const fixtures = (requirement: string, check = '取消') => writeFile(join(cwd, 'eval/requirements.json'), JSON.stringify([
    { id: 'invite', requirement, complex: false, checks: [[check, check]] },
  ]));
  await fixtures('支持取消邀请');
  const calls: string[] = [];
  let failNext = false;
  const gateway = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    calls.push(JSON.parse(Buffer.concat(chunks).toString()).model);
    if (failNext) {
      failNext = false;
      res.writeHead(429).end();
      return;
    }
    const content = JSON.stringify({ summary: '完成', cases: [{
      id: 'case', category: '邀请', precondition: '已有邀请', topic: '取消邀请', priority: 'P2',
      steps: '1. 点击取消', expected: '1. 邀请已撤销',
    }] });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => gateway.close(() => resolve())));
  const address = gateway.address();
  assert.ok(address && typeof address !== 'string');
  const cli = join(cwd, 'eval/run.mts');
  const run = async (model: string, ...args: string[]) => (await promisify(execFile)(process.execPath, [
    '--import', createRequire(import.meta.url).resolve('tsx'), cli, ...args,
  ], { cwd, env: {
    ...process.env, TEST_CASES_LOOPBACK: '1', OPENAI_BASE_URL: 'http://127.0.0.1:' + address.port + '/v1',
    OPENAI_MODEL: model, OPENAI_API_KEY: 'fixture-key-only',
  } })).stdout;

  await run('first', 'single');
  await run('first', 'single');
  assert.deepEqual(calls, ['first']);
  await run('second', 'single');
  assert.deepEqual(calls, ['first', 'second']);
  const previous = JSON.parse(await run('second', 'report'))[0].runId;
  await fixtures('支持取消未接受的邀请，需二次确认', '二次确认');
  failNext = true;
  await run('second', 'single');
  await run('second', 'single');
  await run('second', 'single');
  assert.deepEqual(calls, ['first', 'second', 'second', 'second']);
  const current = JSON.parse(await run('second', 'report')).find((row: { variant: string }) => row.variant === 'single');
  assert.equal(current.model, 'second');
  assert.equal(current.details[0].failed, 0);
  assert.equal(current.details[0].covered, 0);
  assert.notEqual(current.runId, previous);
  const historical = JSON.parse(await run('second', 'report', previous)).find((row: { variant: string }) => row.variant === 'single');
  assert.equal(historical.runId, previous);
  assert.equal(historical.details[0].covered, 1);
  assert.ok(!JSON.stringify(current).includes('fixture-key-only'));
  await appendFile(join(cwd, 'src/lib/agent/testCaseAgent.ts'), '\n// Changed local generator.\n');
  await run('second', 'single');
  assert.equal(calls.length, 5);
  await mkdir(join(cwd, '.eval-results/single'), { recursive: true });
  await cp(join(cwd, '.eval-results/runs', previous, 'single/invite.json'), join(cwd, '.eval-results/single/invite.json'));
  const legacy = JSON.parse(await run('second', 'report', 'legacy')).find((row: { variant: string }) => row.variant === 'single');
  assert.equal(legacy.model, null);
  assert.equal(legacy.details.length, 1);
});
