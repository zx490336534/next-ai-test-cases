import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import type { ChatMessage, MindMapChatResult, TestCaseAgentResult } from './types';

type MindMapNode = {
  data: { text: string };
  children: MindMapNode[];
};

const mindMapSchema: z.ZodType<MindMapNode> = z.lazy(() =>
  z.object({
    data: z.object({ text: z.string() }),
    children: z.array(mindMapSchema),
  }),
);

const schema = z.object({
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
  mindMap: mindMapSchema,
});

const chatSchema = z.object({
  assistantReply: z.string(),
  mindMap: mindMapSchema,
});

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
    const precondition = (c.precondition || '默认前置条件').trim();
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
    data: { text: '@测试用例' },
    children: Array.from(grouped.entries()).map(([category, preMap]) => ({
      data: { text: `@${category.replace(/^@/, '')}` },
      children: Array.from(preMap.entries()).map(([precondition, items]) => ({
        data: { text: `!${precondition.replace(/^!/, '')}` },
        children: items.map((it) => ({
          data: { text: `[${it.priority}] ${it.topic}` },
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

function createModel() {
  return new ChatOpenAI({
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    temperature: 0.2,
    apiKey: process.env.OPENAI_API_KEY,
    configuration: process.env.OPENAI_BASE_URL
      ? {
          baseURL: process.env.OPENAI_BASE_URL,
        }
      : undefined,
  });
}

export async function generateTestCases(requirement: string): Promise<TestCaseAgentResult> {
  const model = createModel();

  const prompt = `你是资深测试架构师。请根据输入需求生成“数量充足、覆盖全面、可执行”的测试用例，并同时返回思维导图树结构。

总体目标：
- 在不重复的前提下，尽量多产出高价值用例。
- 默认至少生成 30 条用例；如果需求非常小，至少生成 20 条；如果需求复杂，可超过 40 条。

覆盖维度（必须覆盖）：
1. 主流程/冒烟：核心成功路径、关键端到端流程。
2. 分支流程：不同角色、不同入口、不同状态流转。
3. 边界值：长度、范围、阈值、次数、时间窗口、分页临界点。
4. 异常与失败：超时、网络抖动、第三方失败、参数非法、幂等重试、降级兜底。
5. 权限与安全：鉴权、越权、未登录、会话过期、数据隔离、输入安全校验。
6. 数据一致性：前后端一致、缓存一致、并发冲突、重复提交、事务回滚。
7. 易用性与兼容性：错误提示可理解、关键兼容场景（Web/移动端或主流浏览器）。

优先级要求：
- P0：主链路、资金/数据安全、核心可用性风险。
- P1：高频分支和重要异常。
- P2/P3：低频或体验优化项。
- 输出中必须同时包含 P0/P1/P2（如适用可含 P3）。

输出规范（对齐 test-case-formatter）：
1. 用例字段固定为：id/category/topic/priority/precondition/steps/expected。
2. category 必须使用测试类别名，不带 @ 前缀（如 功能测试、异常测试、边界测试、安全测试、接口测试、UI测试、性能测试、兼容性测试、数据验证）。
3. topic 为测试用例名称，不包含类别名。
4. steps 使用单个字符串，步骤之间用换行符 \\n 分隔，格式如：
   1. 打开页面
   2. 输入数据
   3. 点击提交
5. expected 使用单个字符串，并与 steps 同编号逐条对应（每个步骤必须有一条期望结果），示例：
   1. 页面打开成功并展示登录表单
   2. 输入值被正确接收并通过前端校验
   3. 提交成功并返回正确反馈
6. steps 和 expected 不能为空，不允许输出空字符串。
7. summary 用 2-4 句话概括覆盖范围、总条数和主要风险点。
6. mindMap 需与用例结构一致：
   - 根节点固定为 @测试用例
   - 第二层为 @类别节点（如 @功能测试）
   - 第三层为 !前置条件节点（如 !已登录用户）
   - 第四层为测试用例节点（建议带优先级前缀，如 [P0] 正常登录测试）
8. 每个节点必须包含 children 字段；叶子节点使用空数组 []，不要省略。
9. 输出必须是结构化 JSON，不要包含 markdown。

信息不足处理：
- 若需求细节缺失，请做“最小必要合理假设”后继续生成，不要因为信息不全而减少覆盖面。可在 summary 中注明关键假设。 

需求如下：
${requirement}`;

  const structured = model.withStructuredOutput(schema, {
    name: 'test_case_agent_output',
  });

  const result = await structured.invoke(prompt);
  const normalizedMindMap = buildMindMapFromCases(result.cases);
  return {
    ...result,
    mindMap: normalizedMindMap,
  };
}

function serializeMessages(messages: ChatMessage[]) {
  return messages.map((m, i) => `${i + 1}. ${m.role}: ${m.content}`).join('\n');
}

export async function chatAndUpdateMindMap(input: {
  messages: ChatMessage[];
  currentMindMap: MindMapNode;
}): Promise<MindMapChatResult> {
  const model = createModel();
  const structured = model.withStructuredOutput(chatSchema, {
    name: 'test_case_agent_chat_output',
  });

  const prompt = `你是测试用例脑图助手。你的职责是根据用户连续对话，增删改当前脑图。

规则：
1. 你只能基于“当前脑图”进行修改，保留未被要求变更的节点。
2. 输出的 mindMap 必须是完整树，而不是增量 patch。
3. 每个节点必须包含 data.text 和 children；叶子节点 children 使用 []。
4. assistantReply 用简洁中文说明本轮做了什么改动。
5. 如果用户要求不清晰，assistantReply 先提出一个澄清问题，同时尽量保持脑图不变。

当前脑图(JSON)：
${JSON.stringify(input.currentMindMap)}

历史对话：
${serializeMessages(input.messages)}`;

  return structured.invoke(prompt);
}
