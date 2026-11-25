import { z } from 'zod';
import type { FollowUp } from './follow-ups';
import { moduleSchema } from './contracts';
import { buildSkeleton } from './mindMap';
import { materialDigest, type MaterialSnapshot } from './material-snapshot';
import { modelError, type Model } from './model';
import { RequestError } from './modelConfig';
import { generateModuleTestCases, generateTestCases, planTestCaseModules } from './testCaseAgent';
import type { MindMapNode, TestCaseModulePlan } from './types';

export const retrySchema = z.object({
  modules: z.array(moduleSchema).min(1).max(8),
  failedIds: z.array(z.string()).min(1).max(8),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
}).refine(({ modules, failedIds }) => new Set(modules.map(({ id }) => id)).size === modules.length
  && failedIds.every((id) => modules.some((module) => module.id === id)));

export type GenerationRetry = z.infer<typeof retrySchema>;
export type Activity = {
  id: string;
  label: string;
  kind: 'step' | 'tool';
  state: 'running' | 'done' | 'warning' | 'error';
  detail?: string;
};

export type GenerationEvent =
  | { type: 'activity'; item: Activity }
  | { type: 'progress'; message: string }
  | { type: 'warning'; message: string }
  | { type: 'plan'; modules: TestCaseModulePlan[]; sourceHash: string; mindMap: MindMapNode }
  | { type: 'module'; id: string; mindMap: MindMapNode }
  | { type: 'module-error'; id: string; message: string }
  | { type: 'complete'; summary: string; mindMap?: MindMapNode; followUps?: FollowUp[] }
  | { type: 'error'; message: string };

// This default favors the smaller call graph until a planned variant passes the evaluation gates.
export const generationConcurrency: 0 | 1 | 2 = 0;

export async function runGeneration(input: {
  model: Model;
  materials: MaterialSnapshot;
  concurrency: 0 | 1 | 2;
  retry?: GenerationRetry;
  suggestFollowUps?: boolean;
  signal: AbortSignal;
  emit: (event: GenerationEvent) => void;
}) {
  const { model, materials, concurrency, retry, signal, emit } = input;
  if (materials.missing) emit({ type: 'warning', message: materials.missing + ' 份资料未读取，结果仅依据已读资料和正文。' });
  signal.throwIfAborted();
  if (concurrency === 0 && !retry) {
    emit({ type: 'progress', message: '正在根据需求生成用例…' });
    emit({ type: 'activity', item: { id: 'generate', kind: 'step', label: '生成用例并校验结构', state: 'running' } });
    const result = await generateTestCases(model, materials, undefined, input.suggestFollowUps);
    signal.throwIfAborted();
    emit({ type: 'activity', item: { id: 'generate', kind: 'step', label: '生成用例并校验结构', state: 'done', detail: result.cases.length + ' 条用例' } });
    emit({ type: 'complete', summary: result.summary, mindMap: result.mindMap, followUps: result.followUps });
    return;
  }

  const sourceHash = await materialDigest(materials);
  if (retry && retry.sourceHash !== sourceHash) {
    throw new RequestError('需求资料已变化，请重新发起生成。已完成的脑图仍保留。', 409);
  }
  let modules: TestCaseModulePlan[];
  let summary: string;
  if (retry) {
    modules = retry.modules;
    summary = '已处理失败模块。';
  } else {
    emit({ type: 'progress', message: '正在规划用例模块…' });
    emit({ type: 'activity', item: { id: 'plan', kind: 'step', label: '规划用例模块', state: 'running' } });
    const result = await planTestCaseModules(model, materials);
    modules = result.modules;
    summary = result.summary;
    emit({ type: 'activity', item: { id: 'plan', kind: 'step', label: '规划用例模块', state: 'done', detail: modules.length + ' 个模块' } });
  }
  signal.throwIfAborted();
  emit({ type: 'plan', modules, sourceHash, mindMap: buildSkeleton(modules) });
  const queued = retry ? modules.filter(({ id }) => retry.failedIds.includes(id)) : modules;
  let nextIndex = 0;
  let failureCount = 0;
  async function worker() {
    while (nextIndex < queued.length) {
      signal.throwIfAborted();
      const target = queued[nextIndex++];
      emit({ type: 'progress', message: '正在生成「' + target.title + '」…' });
      const activity = { id: target.id, kind: 'step' as const, label: '生成「' + target.title + '」' };
      emit({ type: 'activity', item: { ...activity, state: 'running' } });
      try {
        const result = await generateModuleTestCases(model, materials, target, modules);
        signal.throwIfAborted();
        emit({ type: 'module', id: target.id, mindMap: result.mindMap });
        emit({ type: 'activity', item: { ...activity, state: 'done', detail: result.cases.length + ' 条用例' } });
      } catch (error) {
        signal.throwIfAborted();
        failureCount++;
        emit({ type: 'module-error', id: target.id, message: target.title + '：' + modelError(error) });
        emit({ type: 'activity', item: { ...activity, state: 'error', detail: modelError(error) } });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency || 1, queued.length) }, worker));
  signal.throwIfAborted();
  emit({ type: 'complete', summary: failureCount ? failureCount + ' 个模块生成失败，可单独重试。' : summary });
}
