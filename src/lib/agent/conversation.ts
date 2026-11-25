import { isTextUIPart, type UIMessage } from 'ai';
import { z } from 'zod';
import { followUpsSchema } from './follow-ups';
import type { GenerationEvent, GenerationRetry } from './generation';
import type { MindMapNode } from './types';

export type ConversationEvent =
  | Exclude<GenerationEvent, { type: 'activity' }>
  | { type: 'edit'; mindMap: MindMapNode };

const count = z.number().int().nonnegative();
export const conversationMetadataSchema = z.object({
  followUps: followUpsSchema.optional(),
  execution: z.object({
    elapsedMs: count,
    usage: z.object({
      calls: count,
      reported: count,
      totalTokens: count.optional(),
      inputTokens: count.optional(),
      outputTokens: count.optional(),
    }).optional(),
  }).optional(),
}).optional();

export type ConversationMessage = UIMessage<z.infer<typeof conversationMetadataSchema>, { workspace: ConversationEvent }>;
export type RetryRequest = { requirement: string; plan: GenerationRetry };

export function conversationText(message: ConversationMessage) {
  return message.parts.filter(isTextUIPart).map(({ text }) => text).join('').trim();
}
