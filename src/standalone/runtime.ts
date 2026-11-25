import { conversationSchema, streamConversation } from '@/lib/agent/conversation-run';
import { hasRequirementText, requirementLinks } from '@/lib/agent/material-snapshot';
import { createModel } from '@/lib/agent/model';
import { canonicalUrl, defaultModel, errorResponse, type ModelConfig, modelRequestSchema, type ModelSettings, openAiUrl, parseJson, RequestError } from '@/lib/agent/modelConfig';
import { exportXMind, xmindSchema } from '@/lib/agent/xmind';
import { browserHistory } from './history';
import { importBrowserSkills } from './skills';

export const standalone = true;

function modelConfig({ baseUrl, model, apiKey }: ModelSettings = {}): ModelConfig {
  const target = canonicalUrl(baseUrl || openAiUrl);
  const url = new URL(target);
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new RequestError('请输入 HTTPS 网关地址。本机回环网关可使用 HTTP。', 400);
  }
  if (!apiKey) throw new RequestError('请在模型设置中填写 API Key', 400);
  const configuredGateway = document.querySelector<HTMLMetaElement>('meta[name="local-model-gateway"]')?.content;
  const local = location.protocol === 'http:' && location.hostname === '127.0.0.1' && configuredGateway;
  if (local && (target === local || (!new URL(local).pathname.slice(1) && target === local + '/v1'))) {
    return {
      baseUrl: location.origin + '/v1', model: model || defaultModel, apiKey,
      connectionError: '本机启动器连接已断开，请检查启动器是否仍在运行。',
    };
  }
  return {
    baseUrl: target, model: model || defaultModel, apiKey,
    ...(url.protocol === 'http:' && { targetAddressSpace: 'loopback' as const }),
    connectionError: url.protocol === 'http:'
      ? '浏览器无法直连本机网关。若网关不支持跨域请求，请使用 Release 附带的本机启动器。'
      : '浏览器无法连接模型网关，请检查网络和网关的跨域（CORS）设置。',
  };
}

export const workspaceFetch: typeof fetch = async (input, init) => {
  const request = new Request(typeof input === 'string' ? new URL(input, 'https://workspace.invalid') : input, init);
  const path = new URL(request.url).pathname;
  const prefix = '/api/test-case-agent/';
  const [endpoint, id] = path.startsWith(prefix) ? path.slice(prefix.length).split('/') : [];
  try {
    request.signal.throwIfAborted();
    if (endpoint === 'sessions') return await browserHistory(request, id);
    if (endpoint === 'extensions' && request.method === 'GET') return Response.json({ mcp: [], skills: [] });
    if (request.method === 'POST') {
      if (endpoint === 'extensions') return Response.json({ skills: await importBrowserSkills(request) });
      if (endpoint === 'export-xmind') return await exportXMind(await parseJson(request, xmindSchema));
      if (endpoint === 'model-test') {
        const input = await parseJson(request, modelRequestSchema);
        await createModel(modelConfig(input.settings), request.signal).invoke([{ role: 'user', content: 'Reply with OK.' }]);
        return new Response(null, { status: 204 });
      }
      if (endpoint === 'conversation') {
        const input = await parseJson(request, conversationSchema);
        return streamConversation(input, modelConfig(input.settings), request.signal, {
          readsLinks: false,
          resolveSkills: async (_installed, imported) => imported ?? [],
          async collectMaterials(requirement) {
            const links = requirementLinks(requirement);
            if (links.length && !hasRequirementText(requirement, links)) {
              throw new RequestError('请粘贴链接中的需求正文，再发送给 AI。', 422);
            }
            return { requirement, documents: [], missing: links.length };
          },
        });
      }
    }
    throw new RequestError('工作区操作不可用', 404);
  } catch (error) {
    request.signal.throwIfAborted();
    return errorResponse(error);
  }
};
