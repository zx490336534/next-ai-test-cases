import { isTextUIPart, type UIMessage } from 'ai';
import { z } from 'zod';
import { maxRequirementLength } from './contracts';
import { followUpsSchema } from './follow-ups';
import type { GenerationEvent, GenerationRetry } from './generation';
import { materialLimit, materialSourcesSchema, requirementLinks, type MaterialSource } from './material-snapshot';
import type { MindMapNode } from './types';

export type ConversationEvent =
  | Exclude<GenerationEvent, { type: 'activity' }>
  | { type: 'edit'; mindMap: MindMapNode };

const count = z.number().int().nonnegative();
export const conversationMetadataSchema = z.object({
  followUps: followUpsSchema.optional(),
  materialSources: materialSourcesSchema.optional(),
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
export type RetryRequest = { requirement: string; plan?: GenerationRetry };

export function recentMaterialSources(messages: ConversationMessage[]): MaterialSource[] {
  const latest = new Map<string, MaterialSource>();
  for (let i = messages.length - 1; i >= 0; i--) {
    const reply = messages[i];
    if (reply.role !== 'assistant') continue;
    let sources = reply.metadata?.materialSources;
    const request = messages[i - 1];
    // Older replies recorded the successful MCP read as a tool part, before ranges were saved.
    if (!sources && request?.role === 'user' && reply.parts.some((part) =>
      part.type === 'dynamic-tool' && part.toolName === 'read_materials' && part.state === 'output-available'
      && (part.output as { state?: string } | null)?.state === 'done')) {
      const text = conversationText(request);
      if (text.length <= maxRequirementLength) {
        sources = requirementLinks(text).filter((url) => URL.canParse(url)).map((url) => ({ url }));
      }
    }
    for (const source of sources ?? []) {
      if (!latest.has(source.url)) latest.set(source.url, source);
      if (latest.size === materialLimit) return [...latest.values()];
    }
  }
  return [...latest.values()];
}

export function conversationText(message: ConversationMessage) {
  return message.parts.filter(isTextUIPart).map(({ text }) => text).join('').trim();
}

export function conversationTranscript(messages: ConversationMessage[]) {
  const transcript = messages.filter(({ role }) => role !== 'system')
    .map((message) => ({ role: message.role, content: conversationText(message) }))
    .filter(({ content }) => content && content.length <= maxRequirementLength);
  const original = transcript.find(({ role }) => role === 'user');
  const originalRequirement = original && !transcript.slice(-12).includes(original) ? original.content : undefined;
  return { messages: transcript.slice(-20), originalRequirement };
}
