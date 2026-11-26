import { safeValidateUIMessages } from 'ai';
import { z } from 'zod';
import { mindMapSchema } from '@/lib/agent/contracts';
import { conversationMetadataSchema, type ConversationMessage } from '@/lib/agent/conversation';
import { RequestError } from '@/lib/agent/modelConfig';

export const renameSchema = z.object({ title: z.string().trim().min(1).max(120) });
export const reorderSchema = z.object({ id: z.uuid(), targetId: z.uuid(), placement: z.enum(['before', 'after']) });

const saveSchema = z.object({
  version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  writeId: z.uuid().optional(),
  messages: z.array(z.unknown()),
  mindMap: mindMapSchema,
});

export async function validateWorkspaceSave(raw: unknown) {
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) throw new RequestError('无效的会话数据', 400);
  const { messages, mindMap, version, writeId } = parsed.data;
  const result = messages.length ? await safeValidateUIMessages<ConversationMessage>({ messages, metadataSchema: conversationMetadataSchema }) : { success: true as const, data: [] };
  if (!result.success) throw new RequestError('会话消息格式无效', 400);
  return { version, snapshot: { messages: result.data, mindMap, ...(writeId && { writeId }) } };
}
