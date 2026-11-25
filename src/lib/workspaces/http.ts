import { randomUUID } from 'node:crypto';
import { safeValidateUIMessages } from 'ai';
import { z } from 'zod';
import { mindMapSchema } from '@/lib/agent/contracts';
import { conversationMetadataSchema, type ConversationMessage } from '@/lib/agent/conversation';
import { checkRequestOrigin, RequestError } from '@/lib/agent/modelConfig';

const ownerCookie = 'test_cases_workspace_owner';
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const snapshotLimit = 8 * 1024 * 1024;
const saveSchema = z.object({
  version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  messages: z.array(z.unknown()),
  mindMap: mindMapSchema,
});

export function workspaceReply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function workspaceOwner(request: Request, create = false) {
  checkRequestOrigin(request);
  const value = request.headers.get('cookie')?.split(';').map((item) => item.trim())
    .find((item) => item.startsWith(ownerCookie + '='))?.slice(ownerCookie.length + 1);
  if (value && uuid.test(value)) return { id: value };
  if (!create) throw new RequestError('无法识别当前浏览器的会话，请刷新页面', 403);
  const id = randomUUID();
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return {
    id,
    cookie: ownerCookie + '=' + id + '; Path=/api/test-case-agent/sessions; HttpOnly; SameSite=Strict; Max-Age=31536000' + secure,
  };
}

export async function parseWorkspaceSave(request: Request) {
  if (Number(request.headers.get('content-length')) > snapshotLimit) throw new RequestError('会话数据超过 8 MB，无法保存', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError('会话没有可保存的数据', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > snapshotLimit) {
        await reader.cancel().catch(() => undefined);
        throw new RequestError('会话数据超过 8 MB，无法保存', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let raw: unknown;
  try { raw = JSON.parse(Buffer.concat(chunks, size).toString()); } catch { throw new RequestError('无效的会话数据', 400); }
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) throw new RequestError('无效的会话数据', 400);
  const { messages, mindMap, version } = parsed.data;
  const result = messages.length ? await safeValidateUIMessages<ConversationMessage>({ messages, metadataSchema: conversationMetadataSchema }) : { success: true as const, data: [] };
  if (!result.success) throw new RequestError('会话消息格式无效', 400);
  return { version, snapshot: { messages: result.data, mindMap } };
}
