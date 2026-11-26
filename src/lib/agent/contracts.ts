import { z } from 'zod';
import type { MindMapNode } from './types';

export const priorities = ['P0', 'P1', 'P2', 'P3'] as const;
export const prioritySchema = z.enum(priorities);
export const requirementSchema = z.string().trim().min(1).max(40_000);
export const moduleSchema = z.object({
  id: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(1500),
  riskPoints: z.array(z.string().max(600)).max(24),
});
export const planSchema = z.object({
  summary: z.string(),
  modules: z.array(moduleSchema).min(1).max(8),
});
export const caseContentSchema = z.object({
  topic: z.string().trim().min(1),
  priority: prioritySchema,
  steps: z.string().trim().min(1),
  expected: z.string().trim().min(1),
});
export const testCaseSchema = caseContentSchema.extend({
  id: z.string(),
  category: z.string().trim().min(1),
  precondition: z.string().trim().min(1),
});
export const casesSchema = z.object({
  summary: z.string(),
  cases: z.array(testCaseSchema).min(1),
});
export const mindMapSchema: z.ZodType<MindMapNode> = z.lazy(() => z.object({
  data: z.object({
    text: z.string(),
    uid: z.string().optional(),
    id: z.string().optional(),
    tag: z.array(z.string()).optional(),
    priority: prioritySchema.optional(),
  }),
  children: z.array(mindMapSchema),
}));
export const chatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(40_000),
  })).min(1).max(40),
  currentMindMap: mindMapSchema,
});
