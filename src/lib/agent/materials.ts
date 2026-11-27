import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RequestError } from './modelConfig';
import { hasRequirementText, materialLimit, materialReadIntent, requirementLinks, type MaterialSnapshot, type MaterialSource } from './material-snapshot';
export type { MaterialSnapshot } from './material-snapshot';

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
    )).join('\n').trim();
  } finally {
    await client.close().catch(() => undefined);
  }
}

function excerpt(text: string, requirement: string, serverId: string, previous?: MaterialSource) {
  const size = 16_000;
  const total = text.length;
  const lastStart = Math.max(0, total - size);
  const prior = previous?.range;
  let start = prior && prior.start < total ? prior.start : 0;
  const intent = materialReadIntent(requirement);
  if (intent === 'tail') {
    start = lastStart;
  } else if (intent === 'head') {
    start = 0;
  } else if (intent === 'next' && prior && prior.end < total) {
    start = prior.end;
  }
  const end = Math.min(start + size, total);
  return { text: text.slice(start, end), range: { serverId, start, end, total } };
}

export async function collectMaterials(
  requirement: string, signal?: AbortSignal, mcpIds?: string[], previous: MaterialSource[] = [],
): Promise<MaterialSnapshot> {
  const explicit = requirementLinks(requirement);
  const links = explicit.length ? explicit : previous.map(({ url }) => url);
  const documents: MaterialSnapshot['documents'] = [];
  if (!links.length) return { requirement, documents, missing: 0 };
  const configured = await loadServers();
  const selected = mcpIds ? new Set(mcpIds) : undefined;
  if (selected && [...selected].some((id) => !Object.hasOwn(configured, id))) {
    throw new RequestError('已挂载 MCP 列表已变化，请重新选择', 400);
  }
  const servers = Object.entries(configured).filter(([id]) => !selected || selected.has(id));
  for (const link of links.slice(0, materialLimit)) {
    signal?.throwIfAborted();
    try {
      const url = new URL(link);
      if (url.username || url.password) continue;
      const prior = previous.find((source) => source.url === link);
      const matches = servers.filter(([, server]) => server.allowedOrigins.includes(url.origin));
      const source = matches.find(([id]) => id === prior?.range?.serverId) ?? matches[0];
      if (!source) continue;
      const [serverId, server] = source;
      const text = await readDocument(server, link, signal);
      if (text) documents.push({ url: link, ...excerpt(text, requirement, serverId, prior?.range?.serverId === serverId ? prior : undefined) });
    } catch {
      signal?.throwIfAborted();
    }
  }

  const missing = links.length - documents.length;
  if (explicit.length && !documents.length && !hasRequirementText(requirement, explicit)) throw new RequestError('无法读取资料，请粘贴需求正文或检查 MCP 配置', 422);
  return { requirement, documents, missing };
}
