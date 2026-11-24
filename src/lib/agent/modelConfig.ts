import { z } from 'zod';

export const modelSettingsSchema = z.object({
  model: z.string().trim().max(180).optional(),
  baseUrl: z.string().trim().max(2048).optional(),
  apiKey: z.string().trim().max(2048).regex(/^[\x21-\x7e]*$/).optional(),
});
export type ModelSettings = z.infer<typeof modelSettingsSchema>;
const openAiUrl = 'https://api.openai.com/v1';

export class RequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export function isLocalMode() {
  return process.env.TEST_CASES_LOOPBACK === '1';
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/+$/, '');
  } catch {
    throw new RequestError('Base URL 必须是无凭据、查询参数或片段的 HTTP(S) 地址', 400);
  }
}

export function checkRequestOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const url = new URL(request.url);
  const host = request.headers.get('host') ?? url.host;
  if (isLocalMode()) {
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(host) || (origin && origin !== 'http://' + host)) {
      throw new RequestError('本机模式仅接受同源的回环地址请求', 403);
    }
    return;
  }
  if (origin && (origin !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site')) {
    throw new RequestError('仅接受同源请求', 403);
  }
}

export function resolveModelSettings(overrides: ModelSettings = {}) {
  const serverUrl = canonicalUrl(process.env.OPENAI_BASE_URL?.trim() || openAiUrl);
  const baseUrl = overrides.baseUrl ? canonicalUrl(overrides.baseUrl) : serverUrl;
  if (!isLocalMode() && overrides.baseUrl && baseUrl !== serverUrl && baseUrl !== openAiUrl) {
    const allowlist = (process.env.OPENAI_BASE_URL_ALLOWLIST ?? '').split(/[\n,]/).map((url) => url.trim()).filter(Boolean).map(canonicalUrl);
    if (!baseUrl.startsWith('https://') || !allowlist.includes(baseUrl)) {
      throw new RequestError('此 Base URL 未被部署者允许', 400);
    }
  }
  if (!isLocalMode() && !baseUrl.startsWith('https://')) {
    throw new RequestError('HTTP 网关需要通过本机模式连接', 400);
  }
  const apiKey = overrides.apiKey || (baseUrl === serverUrl ? process.env.OPENAI_API_KEY : undefined);
  if (!apiKey) throw new RequestError('请在模型设置中输入 API Key，或配置本地 OPENAI_API_KEY', 400);
  return { baseUrl, apiKey, model: overrides.model || process.env.OPENAI_MODEL || 'gpt-4.1-mini' };
}

export const modelRequestSchema = z.object({ settings: modelSettingsSchema.optional() });

export async function parseRequest<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  checkRequestOrigin(request);
  const raw: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new RequestError('请求参数不合法', 400);
  return parsed.data;
}

export function errorResponse(error: unknown) {
  if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: '处理失败，请检查输入或稍后重试' }, { status: 500 });
}
