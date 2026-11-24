import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runGeneration, type GenerationEvent } from '../src/lib/agent/generation';
import { readMindMap, validateCaseContent } from '../src/lib/agent/mindMap';
import { createModel, type ModelUsage } from '../src/lib/agent/model';
import { resolveModelSettings } from '../src/lib/agent/modelConfig';
import type { TestCaseItem } from '../src/lib/agent/types';
import { casesSchema } from '../src/lib/agent/contracts';

import { loadBaseline } from './baseline.mts';
type Fixture = {
  id: string; requirement: string; complex: boolean; repeat?: boolean;
  document?: string; missing?: boolean; checks: string[][]; forbidden?: string[];
};
type Variant = 'baseline' | 'single' | 'serial' | 'parallel' | 'without-source';
type Trial = {
  id: string; repeat: boolean; variant: Variant; complex: boolean;
  elapsedMs: number; firstMs: number | null; failed: number; limited: number;
  cases: TestCaseItem[]; raw: unknown[]; usage: ModelUsage;
};

const variants: Variant[] = ['baseline', 'single', 'serial', 'parallel', 'without-source'];
const requested = process.argv[2];
if (requested !== 'report' && !variants.includes(requested as Variant)) throw new Error('Choose: report or ' + variants.join(', '));
const variant = requested as Variant;
const output = resolve('.eval-results', variant);
const usageStorage = new AsyncLocalStorage<ModelUsage>();
const upstreamFetch = globalThis.fetch;
const countUsage = () => ({ calls: 0, inputTokens: 0, outputTokens: 0, reported: 0 });

function instrumentBaseline() {
  globalThis.fetch = async (input, init) => {
    const usage = usageStorage.getStore();
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const allowed = new URL(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
    if (url.origin !== allowed.origin || url.pathname !== allowed.pathname.replace(/\/$/, '') + '/chat/completions') {
      throw new Error('Evaluation allows only the configured model endpoint');
    }
    if (usage) usage.calls++;
    const response = await upstreamFetch(input, { ...init, redirect: 'error', signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000) });
    if (usage && response.ok) {
      const payload = await response.clone().json().catch(() => null);
      if (Number.isFinite(payload?.usage?.prompt_tokens) && Number.isFinite(payload?.usage?.completion_tokens)) {
        usage.reported++;
        usage.inputTokens += payload.usage.prompt_tokens;
        usage.outputTokens += payload.usage.completion_tokens;
      }
    }
    return response;
  };
}

async function run() {
  const config = resolveModelSettings();
  const fixtures = JSON.parse(await readFile('eval/requirements.json', 'utf8')) as Fixture[];
  await mkdir(output, { recursive: true });
  const selectedIds = process.argv.slice(3);
  const trials = fixtures.flatMap((fixture) => [{ fixture, repeat: false }, ...(fixture.repeat ? [{ fixture, repeat: true }] : [])])
    .filter(({ fixture }) => (variant !== 'without-source' || !!fixture.document) && (!selectedIds.length || selectedIds.includes(fixture.id)));
  const baseline = variant === 'baseline' ? await loadBaseline() : null;
  if (baseline) {
    process.chdir(resolve('.eval-results', 'baseline-source'));
    instrumentBaseline();
  }

  async function runTrial({ fixture, repeat }: typeof trials[number]) {
    const resultFile = join(output, fixture.id + (repeat ? '-repeat' : '') + '.json');
    if (await readFile(resultFile).catch(() => null)) return;
    const start = performance.now();
    let firstMs: number | null = null;
    let failed = 0;
    let limited = 0;
    const cases: TestCaseItem[] = [];
    const raw: unknown[] = [];
    const signal = AbortSignal.timeout(12 * 60_000);
    const live = createModel(config, signal);
    const usage = baseline ? countUsage() : live.usage;
    function collect(rows: TestCaseItem[]) {
      if (rows.some((row) => {
        try { validateCaseContent(row); return true; } catch { return false; }
      })) firstMs ??= performance.now() - start;
      cases.push(...rows);
    }
    try {
      if (baseline) {
        const requirement = fixture.requirement + (fixture.document ? '\n资料正文：' + fixture.document : '');
        await usageStorage.run(usage, async () => {
          const plan = await baseline.planTestCaseModules(requirement);
          for (const target of plan.modules) {
            const result = await baseline.generateModuleTestCases({ requirement, module: target, modules: plan.modules });
            collect(result.cases);
          }
        });
      } else {
        const documents = fixture.document && variant !== 'without-source'
          ? [{ url: fixture.requirement.match(/https:\/\/spec\.example\.test\/\w+/)?.[0] ?? '', text: fixture.document }] : [];
        const model = {
          usage,
          async invoke(...args: Parameters<typeof live.invoke>) {
            const result = await live.invoke(...args);
            try {
              const cleaned = result.replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi, '');
              const value: unknown = JSON.parse(cleaned);
              if (typeof value === 'object' && value && 'cases' in value) raw.push(value);
            } catch {
              raw.push(null);
            }
            return result;
          },
        };
        function emit(event: GenerationEvent) {
          if (event.type === 'module' || (event.type === 'complete' && event.mindMap)) {
            const map = event.mindMap!;
            const root = event.type === 'module' ? { data: { text: '@测试用例' }, children: [map] } : map;
            collect(readMindMap(root).cases);
          } else if (event.type === 'module-error') {
            failed++;
            if (event.message.includes('限流')) limited++;
          }
        }
        await runGeneration({
          model,
          concurrency: variant === 'serial' ? 1 : variant === 'parallel' ? 2 : 0,
          materials: { requirement: fixture.requirement, documents, missing: Number(!!fixture.missing || variant === 'without-source') },
          signal,
          emit,
        });
      }
    } catch (error) {
      failed++;
      if (error instanceof Error && (error.message.includes('限流') || /429/.test(error.message))) limited++;
    }

    const trial: Trial = { id: fixture.id, repeat, variant, complex: fixture.complex,
      elapsedMs: performance.now() - start, firstMs, failed, limited, usage, cases, raw };
    await writeFile(resultFile, JSON.stringify(trial, null, 2), { mode: 0o600, flag: 'wx' });
    const coverage = score(fixture, cases);
    console.log(fixture.id + (repeat ? ' again' : ''), variant, cases.length, coverage.covered + '/' + coverage.total, 'failures', failed,
      'calls', usage.calls, 'seconds', Math.round(trial.elapsedMs / 1000));
  }

  const jobs = Math.min(3, Math.max(1, Number(process.env.EVAL_JOBS) || 1));
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < trials.length) await runTrial(trials[next++]);
  }));
}

function score(fixture: Fixture, cases: TestCaseItem[]) {
  const fields = cases.map((item) => [item.topic, item.precondition, item.steps, item.expected].join('\n'));
  const missing = fixture.checks.filter(([, ...patterns]) => !fields.some((text) => patterns.every((pattern) => new RegExp(pattern, 'iu').test(text))));
  const invalid = cases.filter((item) => {
    try { validateCaseContent(item); return false; } catch { return true; }
  }).length;
  const unsupported = cases.filter(({ expected }) => (fixture.forbidden ?? []).some((pattern) => new RegExp(pattern, 'iu').test(expected))).length;
  return { covered: fixture.checks.length - missing.length, total: fixture.checks.length, missing: missing.map(([name]) => name), invalid, unsupported };
}

async function report() {
  const fixtures = JSON.parse(await readFile('eval/requirements.json', 'utf8')) as Fixture[];
  const rows: object[] = [];
  for (const variant of variants) {
    const details = [];
    for (const fixture of fixtures) {
      for (const repeat of fixture.repeat ? [false, true] : [false]) {
        const path = resolve('.eval-results', variant, fixture.id + (repeat ? '-repeat' : '') + '.json');
        const raw = await readFile(path, 'utf8').catch(() => '');
        if (!raw) continue;
        const trial: Trial = JSON.parse(raw);
        const invalidWithoutGate = trial.raw.reduce<number>((count, output) => {
          const parsed = casesSchema.safeParse(output);
          return count + (parsed.success ? score(fixture, parsed.data.cases).invalid : 1);
        }, 0);
        details.push({ id: fixture.id, repeat, ...score(fixture, trial.cases), invalidWithoutGate, ...trial.usage,
          elapsedMs: Math.round(trial.elapsedMs), firstMs: trial.firstMs === null ? null : Math.round(trial.firstMs),
          failed: trial.failed, limited: trial.limited, complex: fixture.complex });
      }
    }
    rows.push({ variant, details });
  }
  console.log(JSON.stringify(rows, null, 2));
}

if (requested === 'report') await report();
else await run();
