import type { z } from 'zod';
import { RequestError, type ModelConfig } from './modelConfig';

export type ModelUsage = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reported: number;
  totalTokens?: number;
  detailed?: number;
};
export type ModelMessage = { role: 'system' | 'user'; content: string };
export type Model = {
  invoke: (messages: ModelMessage[]) => Promise<string>;
  usage: ModelUsage;
};
export const modelError = (error: unknown) => error instanceof RequestError ? error.message : '处理失败，请稍后重试';

const zhipuResponsesUrl = 'https://open.bigmodel.cn/api/v1';

function responsesText(output: { type?: string; role?: string; content?: unknown }[] | undefined) {
  if (!Array.isArray(output)) return '';
  return output.flatMap((item) => {
    if (item?.type !== 'message' || item.role !== 'assistant') return [];
    const parts = Array.isArray(item.content) ? item.content : [item.content];
    return parts.flatMap((part) => part?.type === 'output_text' && typeof part.text === 'string' ? [part.text] : []);
  }).join('');
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function createModel(config: ModelConfig, signal?: AbortSignal): Model {
  const useResponses = config.baseUrl === zhipuResponsesUrl;
  const usage: ModelUsage = { calls: 0, inputTokens: 0, outputTokens: 0, reported: 0 };
  async function invoke(messages: ModelMessage[]) {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(180_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    usage.calls++;
    const body = useResponses ? {
      model: config.model,
      input: messages.map((message) => ({ type: 'message', ...message })),
      store: false,
      stream: false,
    } : {
      model: config.model,
      messages,
      ...(!/(^|\/)gpt-[56](?:[.-]|$)/i.test(config.model) && { temperature: 0.2 }),
    };
    const response = await fetch(config.baseUrl + (useResponses ? '/responses' : '/chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
      body: JSON.stringify(body),
      ...(config.targetAddressSpace && { targetAddressSpace: config.targetAddressSpace }),
      redirect: 'error',
      cache: 'no-store',
      signal: requestSignal,
    }).catch(() => {
      signal?.throwIfAborted();
      throw new RequestError(timeout.aborted ? '模型请求超时' : config.connectionError ?? '模型网关不可达或拒绝连接', timeout.aborted ? 504 : 502);
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 413) {
        const error = await response.json().catch(() => null);
        const code = error?.error?.code ?? error?.error?.type;
        if (code === 'context_length_exceeded' || code === 'context_window_exceeded') {
          throw new RequestError('所用模型的上下文容量不足，可减少本轮附带的 Skill，或切换到上下文更大的模型。', 422);
        }
      } else {
        await response.body?.cancel();
      }
      if (response.status === 401 || response.status === 403) throw new RequestError('模型网关拒绝认证，请核对 Key 和模型权限', 401);
      if (response.status === 429) throw new RequestError('模型网关限流，请稍后重试', 429);
      throw new RequestError('模型网关返回错误（HTTP ' + response.status + '）', 502);
    }
    const payload = await response.json().catch(() => null);
    // The gateway can return business errors inside an HTTP 200 response.
    if (useResponses && payload?.success === false) {
      const code = String(payload.code);
      if (code === '401' || code === '1001') {
        throw new RequestError('模型网关拒绝认证，请核对 Key 和模型权限', 401);
      }
      throw new RequestError('智谱网关拒绝请求，请核对标准 API 权限、模型和可用额度', 502);
    }
    const count = payload?.usage;
    const inputTokens = tokenCount(useResponses ? count?.input_tokens : count?.prompt_tokens);
    const outputTokens = tokenCount(useResponses ? count?.output_tokens : count?.completion_tokens);
    const hasBreakdown = inputTokens !== undefined && outputTokens !== undefined;
    const total = tokenCount(count?.total_tokens) ?? (hasBreakdown ? inputTokens + outputTokens : undefined);
    if (total !== undefined) {
      usage.reported++;
      usage.totalTokens = (usage.totalTokens ?? 0) + total;
    }
    if (hasBreakdown) {
      usage.detailed = (usage.detailed ?? 0) + 1;
      usage.inputTokens += inputTokens;
      usage.outputTokens += outputTokens;
    }
    if (useResponses && ['failed', 'incomplete', 'cancelled'].includes(payload?.status)) {
      throw new RequestError('模型未完成本次响应，请重试', 502);
    }
    const text: unknown = useResponses ? responsesText(payload?.output) : payload?.choices?.[0]?.message?.content;
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
