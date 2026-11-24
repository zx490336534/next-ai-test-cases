import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RequestError } from './modelConfig';
import type { TextSkill } from './extensionContracts';

const sourceServer = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  documentTool: z.string().min(1),
  urlArgument: z.string().min(1),
  allowedOrigins: z.array(z.string().url()).min(1),
  transport: z.enum(['stdio', 'http', 'sse']).optional(),
  type: z.enum(['stdio', 'http', 'sse']).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().url().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export type MaterialSnapshot = { requirement: string; documents: { url: string; text: string }[]; missing: number; skills?: TextSkill[] };

async function loadServers() {
  try {
    const raw = JSON.parse(await readFile('mcp.json', 'utf8'));
    const parsed = z.record(z.string(), sourceServer).safeParse(raw?.mcpServers);
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export async function listMcpSources() {
  return Object.entries(await loadServers()).map(([id, server]) => ({ id, name: server.name ?? id }));
}

async function readDocument(server: z.infer<typeof sourceServer>, url: string, signal?: AbortSignal) {
  const remoteOptions = { requestInit: { headers: server.headers, redirect: 'error' as const } };
  const mode = server.transport ?? server.type;
  const transport = mode === 'stdio'
    ? server.command && new StdioClientTransport({ command: server.command, args: server.args ?? [], env: server.env, stderr: 'ignore' })
    : server.url && (mode === 'sse'
      ? new SSEClientTransport(new URL(server.url), remoteOptions)
      : new StreamableHTTPClientTransport(new URL(server.url), remoteOptions));
  if (!transport) return '';
  const client = new Client({ name: 'next-ai-test-cases', version: '1' });
  const options = { signal, timeout: 15_000 };
  try {
    signal?.throwIfAborted();
    await client.connect(transport, options);
    const result = await client.callTool({
      name: server.documentTool,
      arguments: { [server.urlArgument]: url },
    }, undefined, options);
    if (result.isError || !Array.isArray(result.content)) return '';
    return result.content.flatMap((block: { type?: unknown; text?: unknown }) => (
      block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
    )).join('\n').trim().slice(0, 16_000);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export function requirementLinks(requirement: string) {
  return [...new Set((requirement.match(/https?:\/\/[^\s<>"'，。；、！？）)\]]+/gi) ?? []).map((url) => url.replace(/[.,;]+$/, '')))];
}

export async function collectMaterials(requirement: string, signal?: AbortSignal, mcpIds?: string[]): Promise<MaterialSnapshot> {
  const links = requirementLinks(requirement);
  const documents: MaterialSnapshot['documents'] = [];
  if (!links.length) return { requirement, documents, missing: 0 };
  const configured = await loadServers();
  const selected = mcpIds ? new Set(mcpIds) : undefined;
  if (selected && [...selected].some((id) => !Object.hasOwn(configured, id))) {
    throw new RequestError('已挂载 MCP 列表已变化，请重新选择', 400);
  }
  const servers = Object.entries(configured).filter(([id]) => !selected || selected.has(id)).map(([, server]) => server);
  for (const link of links.slice(0, 4)) {
    signal?.throwIfAborted();
    try {
      const url = new URL(link);
      if (url.username || url.password) continue;
      const server = servers.find(({ allowedOrigins }) => allowedOrigins.includes(url.origin));
      const text = server ? await readDocument(server, link, signal) : '';
      if (text) documents.push({ url: link, text });
    } catch {
      signal?.throwIfAborted();
    }
  }

  const missing = links.length - documents.length;
  const prose = links.reduce((text, link) => text.replaceAll(link, ''), requirement);
  // A label or a request to read a link is not a requirement body.
  const usableProse = /[\p{L}\p{N}]{12}/u.test(prose.replace(/[^\p{L}\p{N}]/gu, ''))
    && /\d|\b(?:must|allows?|supports?|when|after|before|only|can|cannot|should|requires?)\b|只能|不能|禁止|支持|必须|需要|允许|失败|成功|为空|点击|展示|限制|拒绝|默认/iu.test(prose);
  if (missing && !documents.length && !usableProse) throw new RequestError('无法读取资料，请粘贴需求正文或检查 MCP 配置', 422);
  return { requirement, documents, missing };
}

export function materialDigest(snapshot: MaterialSnapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
