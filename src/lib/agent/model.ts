import type { z } from 'zod';
import { RequestError, type resolveModelSettings } from './modelConfig';

export type ModelUsage = { calls: number; inputTokens: number; outputTokens: number; reported: number };
export type ModelMessage = { role: 'system' | 'user'; content: string };
export type Model = {
  invoke: (messages: ModelMessage[]) => Promise<string>;
  usage: ModelUsage;
};
export const modelError = (error: unknown) => error instanceof RequestError ? error.message : '处理失败，请稍后重试';

export function createModel(config: ReturnType<typeof resolveModelSettings>, signal?: AbortSignal): Model {
  const usage: ModelUsage = { calls: 0, inputTokens: 0, outputTokens: 0, reported: 0 };
  async function invoke(messages: ModelMessage[]) {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(180_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    usage.calls++;
    const response = await fetch(config.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
      body: JSON.stringify({
        model: config.model,
        messages,
        ...(!/(^|\/)gpt-[56](?:[.-]|$)/i.test(config.model) && { temperature: 0.2 }),
      }),
      redirect: 'error',
      cache: 'no-store',
      signal: requestSignal,
    }).catch(() => {
      signal?.throwIfAborted();
      throw new RequestError(timeout.aborted ? '模型请求超时' : '模型网关不可达或拒绝连接', timeout.aborted ? 504 : 502);
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new RequestError('模型网关拒绝认证，请核对 Key 和模型权限', 401);
      if (response.status === 429) throw new RequestError('模型网关限流，请稍后重试', 429);
      throw new RequestError('模型网关返回错误（HTTP ' + response.status + '）', 502);
    }
    const payload = await response.json().catch(() => null);
    const count = payload?.usage;
    if (Number.isFinite(count?.prompt_tokens) && Number.isFinite(count?.completion_tokens)) {
      usage.reported++;
      usage.inputTokens += count.prompt_tokens;
      usage.outputTokens += count.completion_tokens;
    }
    const text: unknown = payload?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new RequestError('模型未返回文本结果', 502);
    return text.trim();
  }
  return { invoke, usage };
}

export async function structured<T>(model: Model, system: string, input: unknown, schema: z.ZodType<T>, observe?: (raw: unknown) => void): Promise<T> {
  const content = await model.invoke([
    { role: 'system', content: system },
    { role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input) },
  ]);
  const fenced = content.match(/^\x60{3}(?:json)?\s*([\s\S]*?)\s*\x60{3}$/i);
  let raw: unknown;
  try {
    raw = JSON.parse(fenced?.[1] ?? content);
  } catch {
    throw new RequestError('模型未返回有效的 JSON', 422);
  }
  observe?.(raw);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new RequestError('模型返回的结果缺少必需字段或结构无效', 422);
  return parsed.data;
}
