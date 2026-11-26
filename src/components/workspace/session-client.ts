import { workspaceFetch } from '@/lib/client/runtime';
export class SessionRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const endpoint = '/api/test-case-agent/sessions';

export async function sessionRequest<T>(id?: string, options?: RequestInit, query?: URLSearchParams): Promise<T> {
  const path = id ? endpoint + '/' + encodeURIComponent(id) : endpoint;
  const url = query?.size ? path + '?' + query.toString() : path;
  const response = await workspaceFetch(url, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) throw new SessionRequestError(data?.error || '无法连接会话历史，请重试', response.status);
  return data as T;
}
