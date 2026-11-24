import { isTextUIPart, type UIMessage } from 'ai';
import type { GenerationEvent, GenerationRetry } from './generation';
import type { MindMapNode } from './types';

export type ConversationEvent =
  | Exclude<GenerationEvent, { type: 'activity' }>
  | { type: 'edit'; mindMap: MindMapNode };

export type ConversationMessage = UIMessage<unknown, { workspace: ConversationEvent }>;
export type RetryRequest = { requirement: string; plan: GenerationRetry };

export function conversationText(message: ConversationMessage) {
  return message.parts.filter(isTextUIPart).map(({ text }) => text).join('').trim();
}
