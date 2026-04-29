import { ChatOpenAI } from '@langchain/openai';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { createAgent } from 'langchain';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type {
  ChatMessage,
  MindMapChatResult,
  ModuleTestCaseResult,
  TestCaseAgentResult,
  TestCaseModulePlan,
  TestCasePlanResult,
} from './types';

type MindMapNode = {
  data: {
    text: string;
    uid?: string;
    id?: string;
    tag?: string[];
    priority?: 'P0' | 'P1' | 'P2' | 'P3';
  };
  children: MindMapNode[];
};

type ParsedMindMapNode = {
  data: {
    text: string;
    uid?: string | null;
    id?: string | null;
    tag?: string[] | null;
    priority?: 'P0' | 'P1' | 'P2' | 'P3' | null;
  };
  children: ParsedMindMapNode[];
};

const PRECONDITION_TAG = '前置';

const mindMapNodeDataParseSchema = z.object({
  text: z.string(),
  uid: z.string().nullable().optional(),
  id: z.string().nullable().optional(),
  tag: z.array(z.string()).nullable().optional(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).nullable().optional(),
}).passthrough();

const mindMapParseSchema: z.ZodType<ParsedMindMapNode> = z.lazy(() =>
  z.object({
    data: mindMapNodeDataParseSchema,
    children: z.array(mindMapParseSchema),
  }),
);

const generationSchema = z.object({
  summary: z.string(),
  cases: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      topic: z.string(),
      precondition: z.string(),
      steps: z.string(),
      expected: z.string(),
      priority: z.enum(['P0', 'P1', 'P2', 'P3']),
    }),
  ),
});

const planSchema = z.object({
  summary: z.string(),
  modules: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      riskPoints: z.array(z.string()),
    }),
  ),
});

const chatSchema = z.object({
  assistantReply: z.string(),
  mindMap: mindMapParseSchema,
});

const TEST_CASE_GENERATION_GUIDE = `生成测试用例时必须遵守：
1. 先在内部识别一级功能模块骨架，再逐个模块补充完整场景，最后做一次质量审查；最终只输出完整 JSON。
2. 覆盖必须按模块组织，避免把所有用例堆到“功能测试”一个分类中；类别要能帮助阅读者快速定位风险。
3. 每个用例都必须可执行：前置条件、步骤、期望结果不能为空，步骤和期望结果必须按编号一一对应。
4. 不输出重复用例；同一风险点如果需要多数据覆盖，应体现在步骤或标题中，而不是复制相同用例。
5. 优先级必须体现风险：P0 只给主链路、数据安全、资金、权限、核心可用性；P1 给高频分支和关键异常；P2/P3 给低频、兼容或体验项。
6. 信息不足时做最小必要合理假设，继续生成，并在 summary 里说明关键假设。`;

const COVERAGE_GUIDE = `覆盖维度（必须尽量覆盖）：
1. 主流程/冒烟：核心成功路径、关键端到端流程。
2. 分支流程：不同角色、不同入口、不同状态流转。
3. 边界值：长度、范围、阈值、次数、时间窗口、分页临界点。
4. 异常与失败：超时、网络抖动、第三方失败、参数非法、幂等重试、降级兜底。
5. 权限与安全：鉴权、越权、未登录、会话过期、数据隔离、输入安全校验。
6. 数据一致性：前后端一致、缓存一致、并发冲突、重复提交、事务回滚。
7. 易用性与兼容性：错误提示可理解、关键兼容场景（Web/移动端或主流浏览器）。`;

const STRUCTURED_OUTPUT_GUIDE = `输出规范：
1. 字段固定为：summary/cases。
2. cases[].category 必须使用测试类别名，不带 @ 前缀。
3. cases[].topic 为测试用例名称，不包含类别名。
4. cases[].steps 使用单个字符串，步骤之间用换行符 \\n 分隔，格式如：1. 打开页面。
5. cases[].expected 使用单个字符串，并与 steps 同编号逐条对应。
6. 系统会根据 cases 自动构建脑图，因此不要额外输出 mindMap 或其他字段。
7. 最终只输出结构化 JSON，不要包含 markdown、解释或额外文本。`;

function normalizePriority(value: string): 'P0' | 'P1' | 'P2' | 'P3' {
  const priority = value.trim().toUpperCase();
  if (priority === 'P0' || priority === 'P1' || priority === 'P2' || priority === 'P3') return priority;
  return 'P2';
}

function stripPriorityPrefix(text: string) {
  return text.replace(/^\s*\[?P[0-3]\]?\s*[-:：]?\s*/i, '').trim();
}

function stripPreconditionPrefix(text: string) {
  return text.replace(/^\s*!\s*/, '').trim();
}

function extractPriorityPrefix(text: string): 'P0' | 'P1' | 'P2' | 'P3' | null {
  const match = text.match(/^\s*\[?\s*(P[0-3])\s*\]?\s*[-:：]?/i);
  return match ? (match[1].toUpperCase() as 'P0' | 'P1' | 'P2' | 'P3') : null;
}

function normalizePriorityTag(value: unknown): 'P0' | 'P1' | 'P2' | 'P3' | null {
  return typeof value === 'string' && /^P[0-3]$/i.test(value.trim())
    ? (value.trim().toUpperCase() as 'P0' | 'P1' | 'P2' | 'P3')
    : null;
}

function normalizeNumberedLines(value: string, fallback: string) {
  const lines = (value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const safeLines = lines.length > 0 ? lines : [fallback];
  return safeLines
    .map((line, index) => {
      if (/^\d+\s*[\.\、:：)]/.test(line)) return line;
      return `${index + 1}. ${line}`;
    })
    .join('\n');
}

function normalizeCases(cases: TestCaseAgentResult['cases']) {
  const seen = new Set<string>();
  const normalized: TestCaseAgentResult['cases'] = [];

  for (const item of cases || []) {
    const category = (item.category || '功能测试').replace(/^@/, '').trim() || '功能测试';
    const precondition = stripPreconditionPrefix(item.precondition || '默认前置条件') || '默认前置条件';
    const topic = stripPriorityPrefix(item.topic || '未命名测试') || '未命名测试';
    const key = `${category}|${precondition}|${topic}`.toLowerCase();

    if (seen.has(key)) continue;
    seen.add(key);

    const steps = normalizeNumberedLines(item.steps, '执行待测功能的核心操作');
    const expected = normalizeNumberedLines(item.expected, '系统返回与需求一致的结果');

    normalized.push({
      ...item,
      id: item.id?.trim() || `TC-${String(normalized.length + 1).padStart(3, '0')}`,
      category,
      precondition,
      topic,
      steps,
      expected,
      priority: normalizePriority(item.priority),
    });
  }

  return normalized;
}

function normalizeModuleId(value: string, index: number) {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return id || `module-${String(index + 1).padStart(2, '0')}`;
}

function normalizeModules(modules: TestCaseModulePlan[]): TestCaseModulePlan[] {
  const seen = new Set<string>();
  const normalized: TestCaseModulePlan[] = [];

  for (const item of modules || []) {
    const title = (item.title || '').replace(/^@/, '').trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push({
      id: normalizeModuleId(item.id || title, normalized.length),
      title,
      description: (item.description || `${title}相关测试范围`).trim(),
      riskPoints: Array.isArray(item.riskPoints)
        ? item.riskPoints.map((risk) => risk.trim()).filter(Boolean)
        : [],
    });
  }

  return normalized.length > 0
    ? normalized
    : [
        {
          id: 'module-01',
          title: '核心流程',
          description: '需求核心流程与关键异常覆盖',
          riskPoints: ['主流程正确性', '关键异常处理', '数据一致性'],
        },
      ];
}

function normalizeModuleCases(module: TestCaseModulePlan, cases: TestCaseAgentResult['cases']) {
  return normalizeCases(cases).map((item, index) => ({
    ...item,
    id: `${module.id}-TC-${String(index + 1).padStart(3, '0')}`,
    category: module.title,
    topic: stripPriorityPrefix(item.topic) || item.topic,
  }));
}

type McpServerEntry = {
  type?: 'http' | 'stdio' | 'sse';
  transport?: 'http' | 'stdio' | 'sse';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
};

type McpConfig = {
  mcpServers?: Record<string, McpServerEntry>;
};

function splitNumberedLines(text: string) {
  const lines = (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];
  return lines;
}

function buildExpectedLine(stepIndex: number, expectedLines: string[]) {
  if (expectedLines[stepIndex]) return expectedLines[stepIndex];
  if (expectedLines.length > 0) return expectedLines[0];
  return `期望结果 ${stepIndex + 1}`;
}

function buildMindMapFromCases(
  cases: Array<{
    category: string;
    topic: string;
    priority: 'P0' | 'P1' | 'P2' | 'P3';
    precondition: string;
    steps: string;
    expected: string;
    id: string;
  }>,
): MindMapNode {
  const grouped = new Map<
    string,
    Map<string, Array<{ id: string; topic: string; priority: 'P0' | 'P1' | 'P2' | 'P3'; steps: string; expected: string }>>
  >();

  for (const c of cases) {
    const category = (c.category || '功能测试').trim();
    const precondition = stripPreconditionPrefix(c.precondition || '默认前置条件') || '默认前置条件';
    const topic = (c.topic || '未命名测试').trim();

    if (!grouped.has(category)) {
      grouped.set(category, new Map());
    }
    const preMap = grouped.get(category)!;
    if (!preMap.has(precondition)) {
      preMap.set(precondition, []);
    }
    preMap.get(precondition)!.push({
      id: c.id,
      topic,
      priority: c.priority,
      steps: (c.steps || '').trim(),
      expected: (c.expected || '').trim(),
    });
  }

  return {
    data: { text: '@测试用例', uid: 'root', id: 'root' },
    children: Array.from(grouped.entries()).map(([category, preMap]) => ({
      data: { text: `@${category.replace(/^@/, '')}` },
      children: Array.from(preMap.entries()).map(([precondition, items]) => ({
        data: { text: stripPreconditionPrefix(precondition), tag: [PRECONDITION_TAG] },
        children: items.map((it) => ({
          data: { text: stripPriorityPrefix(it.topic) || '未命名测试', priority: it.priority, tag: [it.priority], id: it.id, uid: it.id },
          children: (() => {
            const stepLines = splitNumberedLines(it.steps);
            const expectedLines = splitNumberedLines(it.expected);
            const safeSteps = stepLines.length > 0 ? stepLines : ['1. 未提供测试步骤'];
            const safeExpected =
              expectedLines.length > 0 ? expectedLines : safeSteps.map((_, idx) => buildExpectedLine(idx, expectedLines));

            return [
              {
                data: { text: `测试步骤\n${safeSteps.join('\n')}` },
                children: [
                  {
                    data: { text: `期望结果\n${safeExpected.join('\n')}` },
                    children: [],
                  },
                ],
              },
            ];
          })(),
        })),
      })),
    })),
  };
}

function buildSkeletonMindMap(modules: TestCaseModulePlan[]): MindMapNode {
  return {
    data: { text: '@测试用例', uid: 'root', id: 'root' },
    children: modules.map((module) => ({
      data: { text: `@${module.title}`, uid: module.id, id: module.id },
      children: [],
    })),
  };
}

function buildModuleMindMapFromCases(module: TestCaseModulePlan, cases: TestCaseAgentResult['cases']): MindMapNode {
  const grouped = new Map<string, TestCaseAgentResult['cases']>();

  for (const c of cases) {
    const precondition = stripPreconditionPrefix(c.precondition || '默认前置条件') || '默认前置条件';
    if (!grouped.has(precondition)) {
      grouped.set(precondition, []);
    }
    grouped.get(precondition)!.push(c);
  }

  return {
    data: { text: `@${module.title}`, uid: module.id, id: module.id },
    children: Array.from(grouped.entries()).map(([precondition, items], preIndex) => ({
      data: {
        text: stripPreconditionPrefix(precondition),
        uid: `${module.id}-pre-${String(preIndex + 1).padStart(2, '0')}`,
        id: `${module.id}-pre-${String(preIndex + 1).padStart(2, '0')}`,
        tag: [PRECONDITION_TAG],
      },
      children: items.map((it) => ({
        data: { text: stripPriorityPrefix(it.topic) || '未命名测试', priority: it.priority, tag: [it.priority], id: it.id, uid: it.id },
        children: (() => {
          const stepLines = splitNumberedLines(it.steps);
          const expectedLines = splitNumberedLines(it.expected);
          const safeSteps = stepLines.length > 0 ? stepLines : ['1. 未提供测试步骤'];
          const safeExpected =
            expectedLines.length > 0 ? expectedLines : safeSteps.map((_, idx) => buildExpectedLine(idx, expectedLines));

          return [
            {
              data: { text: `测试步骤\n${safeSteps.join('\n')}` },
              children: [
                {
                  data: { text: `期望结果\n${safeExpected.join('\n')}` },
                  children: [],
                },
              ],
            },
          ];
        })(),
      })),
    })),
  };
}

function normalizeParsedMindMap(node: ParsedMindMapNode): MindMapNode {
  const tags = (node.data.tag || []).map(String).filter(Boolean);
  const priority =
    normalizePriorityTag(node.data.priority) ||
    tags.map((tag) => normalizePriorityTag(tag)).find(Boolean) ||
    extractPriorityPrefix(node.data.text);
  const text = priority ? stripPriorityPrefix(node.data.text) || node.data.text : node.data.text;
  const hasPreconditionTag = tags.includes(PRECONDITION_TAG) || text.trim().startsWith('!');
  const cleanText = stripPreconditionPrefix(text) || text;
  const businessTags = tags.filter((tag) => !normalizePriorityTag(tag) && tag !== PRECONDITION_TAG);
  const nextTags = [
    ...(priority ? [priority] : []),
    ...(hasPreconditionTag ? [PRECONDITION_TAG] : []),
    ...businessTags,
  ];

  return {
    data: {
      text: cleanText,
      ...(node.data.uid ? { uid: node.data.uid } : {}),
      ...(node.data.id ? { id: node.data.id } : {}),
      ...(priority ? { priority } : {}),
      ...(nextTags.length > 0 ? { tag: nextTags } : {}),
    },
    children: node.children.map((child) => normalizeParsedMindMap(child)),
  };
}

function createModel() {
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const supportsCustomTemperature = !/^gpt-5(?:\.|-|$)/i.test(model);

  return new ChatOpenAI({
    model,
    ...(supportsCustomTemperature ? { temperature: 0.2 } : {}),
    apiKey: process.env.OPENAI_API_KEY,
    configuration: process.env.OPENAI_BASE_URL
      ? {
          baseURL: process.env.OPENAI_BASE_URL,
        }
      : undefined,
  });
}

function loadMcpServersConfig() {
  const filePath = path.resolve(process.cwd(), 'mcp.json');
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as McpConfig;
    const mcpServers = parsed?.mcpServers || {};
    const normalized: Record<string, Record<string, unknown>> = {};

    for (const [name, server] of Object.entries(mcpServers)) {
      const mode = server.transport || server.type;
      if (mode === 'stdio') {
        if (!server.command) continue;
        normalized[name] = {
          transport: 'stdio',
          command: server.command,
          args: server.args || [],
          env: server.env || {},
        };
        continue;
      }

      if (!server.url) continue;
      normalized[name] =
        mode === 'sse'
          ? {
              transport: 'sse',
              url: server.url,
              headers: server.headers || {},
            }
          : {
              url: server.url,
              headers: server.headers || {},
            };
    }

    return normalized;
  } catch {
    return {};
  }
}

function extractTextFromAgentResult(result: unknown) {
  const data = result as { messages?: Array<{ content?: unknown }> };
  const messages = data?.messages || [];
  const last = messages[messages.length - 1];
  const content = last?.content;

  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        const block = item as { text?: string };
        return block.text || '';
      })
      .join('\n')
      .trim();
  }

  return '';
}

function extractTextFromModelResponse(result: unknown) {
  const content = (result as { content?: unknown })?.content;

  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        const block = item as { text?: string };
        return block.text || '';
      })
      .join('\n')
      .trim();
  }

  return extractTextFromAgentResult(result);
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/i);
  const source = (fenced ? fenced[1] : text).trim();
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return source.slice(start, end + 1);
  }
  return source;
}

function shouldUseMcp(prompt: string) {
  return /https?:\/\//i.test(prompt) || /(confluence|kaptain|jira|wiki|需求链接|需求地址|文档地址|页面链接|cf\.qunhequnhe\.com|kaptain\.qunhequnhe\.com)/i.test(prompt);
}

async function invokeStructuredWithMcp<T>(params: {
  schema: z.ZodType<T>;
  schemaName: string;
  prompt: string;
}): Promise<T> {
  const model = createModel();
  const direct = model.withStructuredOutput(params.schema, { name: params.schemaName });
  const mcpServers = shouldUseMcp(params.prompt) ? loadMcpServersConfig() : {};

  if (Object.keys(mcpServers).length === 0) {
    return (await direct.invoke(params.prompt)) as T;
  }

  let client: MultiServerMCPClient | null = null;
  try {
    // 按 LangChain 官方 MCP 文档方式：直接传 server map 创建 client
    client = new MultiServerMCPClient(mcpServers as ConstructorParameters<typeof MultiServerMCPClient>[0]);

    const tools = await client.getTools();
    if (tools.length === 0) {
      return (await direct.invoke(params.prompt)) as T;
    }

    const agent = createAgent({
      model,
      tools,
      systemPrompt:
        '你是测试用例助手。可以按需调用 MCP 工具获取外部信息。最终回复必须只输出一个 JSON 对象，不要包含 markdown、解释或额外文本。',
    });

    const result = await agent.invoke({
      messages: [{ role: 'user', content: params.prompt }],
    });

    const text = extractTextFromAgentResult(result);
    const jsonText = extractJsonObject(text);
    const parsed = JSON.parse(jsonText);
    return params.schema.parse(parsed);
  } catch {
    return (await direct.invoke(params.prompt)) as T;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

async function invokeJsonWithMcp<T>(params: {
  schema: z.ZodType<T>;
  prompt: string;
}): Promise<T> {
  const model = createModel();
  const mcpServers = shouldUseMcp(params.prompt) ? loadMcpServersConfig() : {};

  const runDirect = async () => {
    const result = await model.invoke(params.prompt);
    const text = extractTextFromModelResponse(result);
    const jsonText = extractJsonObject(text);
    return params.schema.parse(JSON.parse(jsonText));
  };

  if (Object.keys(mcpServers).length === 0) {
    return runDirect();
  }

  let client: MultiServerMCPClient | null = null;
  try {
    client = new MultiServerMCPClient(mcpServers as ConstructorParameters<typeof MultiServerMCPClient>[0]);

    const tools = await client.getTools();
    if (tools.length === 0) {
      return runDirect();
    }

    const agent = createAgent({
      model,
      tools,
      systemPrompt:
        '你是测试用例脑图助手。可以按需调用 MCP 工具获取外部信息。最终回复必须只输出一个 JSON 对象，不要包含 markdown、解释或额外文本。',
    });

    const result = await agent.invoke({
      messages: [{ role: 'user', content: params.prompt }],
    });

    const text = extractTextFromAgentResult(result);
    const jsonText = extractJsonObject(text);
    return params.schema.parse(JSON.parse(jsonText));
  } catch {
    return runDirect();
  } finally {
    if (client) {
      await client.close();
    }
  }
}

export async function generateTestCases(requirement: string): Promise<TestCaseAgentResult> {
  const prompt = `你是资深测试架构师。请根据输入需求生成“数量充足、覆盖全面、可执行”的测试用例。

总体目标：
- 在不重复的前提下，尽量多产出高价值用例。
- 默认至少生成 30 条用例；如果需求非常小，至少生成 20 条；如果需求复杂，可超过 40 条。

${TEST_CASE_GENERATION_GUIDE}

${COVERAGE_GUIDE}

优先级要求：
- P0：主链路、资金/数据安全、核心可用性风险。
- P1：高频分支和重要异常。
- P2/P3：低频或体验优化项。
- 输出中必须同时包含 P0/P1/P2（如适用可含 P3）。

${STRUCTURED_OUTPUT_GUIDE}

质量审查：
- 输出前自查是否遗漏主流程、权限、异常、边界、数据一致性。
- 自查 steps/expected 是否逐条对应。
- 自查用例标题是否可读、互不重复、没有空节点。

信息不足处理：
- 若需求细节缺失，请做“最小必要合理假设”后继续生成，不要因为信息不全而减少覆盖面。可在 summary 中注明关键假设。 

需求如下：
${requirement}`;

  const result = await invokeStructuredWithMcp({
    schema: generationSchema,
    schemaName: 'test_case_agent_output',
    prompt,
  });
  const normalizedCases = normalizeCases(result.cases);
  const normalizedMindMap = buildMindMapFromCases(normalizedCases);
  return {
    ...result,
    cases: normalizedCases,
    mindMap: normalizedMindMap,
  };
}

export async function planTestCaseModules(requirement: string): Promise<TestCasePlanResult> {
  const prompt = `你是资深测试架构师。请先根据需求拆解测试用例脑图的一级模块骨架。

目标：
- 只输出一级模块规划，不要生成具体测试用例。
- 默认拆成 4-7 个一级模块；需求很小时不少于 3 个，复杂需求可以 8 个。
- 模块标题要短、可作为脑图一级节点，不能带 @ 前缀。
- 每个模块要给出该模块的测试范围描述和关键风险点。
- id 使用小写英文、数字、中划线或下划线，保证模块间唯一。
- 最终只输出结构化 JSON，字段固定为 summary/modules。

${COVERAGE_GUIDE}

需求如下：
${requirement}`;

  const result = await invokeStructuredWithMcp({
    schema: planSchema,
    schemaName: 'test_case_module_plan',
    prompt,
  });
  const modules = normalizeModules(result.modules);

  return {
    summary: result.summary,
    modules,
    mindMap: buildSkeletonMindMap(modules),
  };
}

export async function generateModuleTestCases(input: {
  requirement: string;
  module: TestCaseModulePlan;
  modules: TestCaseModulePlan[];
}): Promise<ModuleTestCaseResult> {
  const targetModule = normalizeModules([input.module])[0];
  const allModules = normalizeModules(input.modules);
  const prompt = `你是资深测试架构师。现在只为指定一级模块生成可执行测试用例。

整体需求：
${input.requirement}

一级模块清单：
${allModules.map((item, index) => `${index + 1}. ${item.title}：${item.description}`).join('\n')}

当前只处理模块：
- 标题：${targetModule.title}
- 范围：${targetModule.description}
- 风险点：${targetModule.riskPoints.length > 0 ? targetModule.riskPoints.join('、') : '主流程、异常、边界、权限、数据一致性'}

生成要求：
- 只生成“${targetModule.title}”模块内的用例，不要扩散到其他一级模块。
- 默认生成 6-10 条高价值用例；模块很小时不少于 4 条，复杂模块可超过 10 条。
- cases[].category 统一写为“${targetModule.title}”，不要带 @ 前缀。
- cases[].topic 不要包含 [P0]/[P1]/[P2]/[P3] 前缀，优先级只写在 priority 字段。

${TEST_CASE_GENERATION_GUIDE}

${COVERAGE_GUIDE}

${STRUCTURED_OUTPUT_GUIDE}`;

  const result = await invokeStructuredWithMcp({
    schema: generationSchema,
    schemaName: 'test_case_module_output',
    prompt,
  });
  const cases = normalizeModuleCases(targetModule, result.cases);

  return {
    summary: result.summary,
    module: targetModule,
    cases,
    mindMap: buildModuleMindMapFromCases(targetModule, cases),
  };
}

function serializeMessages(messages: ChatMessage[]) {
  return messages.map((m, i) => `${i + 1}. ${m.role}: ${m.content}`).join('\n');
}

export async function chatAndUpdateMindMap(input: {
  messages: ChatMessage[];
  currentMindMap: MindMapNode;
}): Promise<MindMapChatResult> {
  const prompt = `你是测试用例脑图助手。你的职责是根据用户连续对话，增删改当前脑图。

规则：
1. 先判断用户意图：新增、删除、改名、调整优先级、补充场景、质量审查或澄清。
2. 你只能基于“当前脑图”进行修改，保留未被要求变更的节点；除非用户明确要求重做，不要整体重写。
3. 输出的 mindMap 必须是完整树，而不是增量 patch。
4. 每个节点必须包含 data.text 和 children；叶子节点 children 使用 []。
5. 新增用例必须遵守：
   - 类别节点用 @ 开头；前置条件节点不要把 ! 写进 data.text，使用 data.tag: ["前置"] 标识。
   - 用例节点不要把 [P0]/[P1]/[P2]/[P3] 写进 data.text；优先级必须写入 data.priority，并同步放入 data.tag 数组。
   - 测试步骤和期望结果按父子结构组织，并逐条编号对应。
6. 删除或修改时要精准命中用户指定范围，避免误删相邻类别或前置条件。
7. assistantReply 用 1-2 句简洁中文说明本轮做了什么改动；如果用户要求不清晰，先提出澄清问题，同时尽量保持脑图不变。

当前脑图(JSON)：
${JSON.stringify(input.currentMindMap)}

历史对话：
${serializeMessages(input.messages)}`;

  const result = await invokeJsonWithMcp({
    schema: chatSchema,
    prompt,
  });

  return {
    ...result,
    mindMap: normalizeParsedMindMap(result.mindMap),
  };
}
