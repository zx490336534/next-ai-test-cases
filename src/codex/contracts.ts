import { z } from 'zod';
import { requirementSchema, testCaseSchema } from '../lib/agent/contracts';
import type { TestCaseItem } from '../lib/agent/types';

export const suiteId = z.uuid().describe('工作区 ID');
export const runId = z.uuid().describe('执行批次 ID');
export const revision = z.number().int().positive().describe('最近读取的工作区版本');
export const caseId = z.uuid().describe('持久用例 ID');
export const caseFields = testCaseSchema.omit({ id: true }).extend({
  topic: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(120),
  precondition: z.string().trim().min(1).max(2000),
  steps: z.string().trim().min(1).max(8000).describe('按行编号的操作列表'),
  expected: z.string().trim().min(1).max(8000).describe('按行编号且逐条配对的可观察结果'),
});
export const suiteDetails = z.object({
  title: z.string().trim().min(1).max(160),
  requirement: requirementSchema,
  context: z.string().trim().max(12_000).describe('仓库、测试环境、范围、前置条件与已知限制，不填密钥'),
});
export const createSuiteInput = suiteDetails.extend({
  context: suiteDetails.shape.context.default(''),
  cases: z.array(caseFields).min(1).max(120),
});
export const editSuiteInput = z.object({
  suiteId,
  revision,
  details: suiteDetails.partial().optional(),
  changes: z.array(z.discriminatedUnion('action', [
    z.object({ action: z.literal('add'), entry: caseFields }),
    z.object({ action: z.literal('update'), caseId, entry: caseFields.partial() }),
    z.object({ action: z.literal('remove'), caseId }),
  ])).max(120).default([]),
}).refine(({ changes, details }) => changes.length > 0 || Boolean(details && Object.keys(details).length), '请提交至少一项修改');

export const startRunInput = z.object({
  suiteId,
  revision,
  caseIds: z.array(caseId).min(1).max(120),
  target: z.string().trim().min(1).max(1000).describe('由用户确定的执行对象和环境'),
});
export const outcomeSchema = z.object({
  caseId,
  status: z.enum(['passed', 'failed', 'blocked', 'skipped']),
  evidence: z.string().trim().min(1).max(8000).describe('实际观察、结果与可回查的证据，阻塞或跳过时写明原因'),
});
export const recordRunInput = z.object({ suiteId, runId, outcomes: z.array(outcomeSchema).min(1).max(120) });
export type CaseFields = z.infer<typeof caseFields>;
export type Suite = z.infer<typeof suiteDetails> & {
  id: string;
  revision: number;
  updatedAt: string;
  cases: TestCaseItem[];
};
export type Outcome = z.infer<typeof outcomeSchema>;
export type CaseRun = {
  id: string;
  suiteId: string;
  revision: number;
  target: string;
  context: string;
  startedAt: string;
  cases: TestCaseItem[];
  outcomes: Outcome[];
};
export type SuiteView = { suite: Suite; lastRun: CaseRun | null };
