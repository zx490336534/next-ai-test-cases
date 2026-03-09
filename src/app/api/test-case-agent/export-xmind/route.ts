import JSZip from 'jszip';
import { NextResponse } from 'next/server';
import { z } from 'zod';

type MindMapNode = {
  data: { text: string };
  children: MindMapNode[];
};

type TestCaseItem = {
  id: string;
  category: string;
  topic: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  precondition: string;
  steps: string;
  expected: string;
};

const mindMapSchema: z.ZodType<MindMapNode> = z.lazy(() =>
  z.object({
    data: z.object({ text: z.string() }),
    children: z.array(mindMapSchema),
  }),
);

const caseSchema = z.object({
  id: z.string(),
  category: z.string(),
  topic: z.string(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  precondition: z.string(),
  steps: z.string(),
  expected: z.string(),
});

const reqSchema = z.object({
  mindMap: mindMapSchema,
  testCases: z.array(caseSchema).optional(),
  title: z.string().optional(),
});

function uid() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function parsePriorityFromText(text: string): { cleanTitle: string; priority?: 'P0' | 'P1' | 'P2' | 'P3' } {
  const raw = (text || '').trim();
  const match = raw.match(/^\[?\s*(P[0-3])\s*\]?\s*[-:：]?\s*(.*)$/i);
  if (!match) {
    return { cleanTitle: raw };
  }
  const priority = match[1].toUpperCase() as 'P0' | 'P1' | 'P2' | 'P3';
  const cleanTitle = (match[2] || '').trim() || raw;
  return { cleanTitle, priority };
}

function toPriorityMarker(priority: 'P0' | 'P1' | 'P2' | 'P3') {
  // XMind 任务优先级图标：1~4
  const markerId = {
    P0: 'priority-1',
    P1: 'priority-2',
    P2: 'priority-3',
    P3: 'priority-4',
  }[priority];
  return markerId;
}

function toXmindTopic(node: MindMapNode): Record<string, unknown> {
  const parsed = parsePriorityFromText(node.data.text || '未命名节点');
  const topic: Record<string, unknown> = {
    id: uid(),
    title: parsed.cleanTitle || '未命名节点',
  };

  if (parsed.priority) {
    const markerId = toPriorityMarker(parsed.priority);
    topic.markers = [{ markerId }];
    topic.markerRefs = [markerId];
  }

  if (node.children.length > 0) {
    topic.children = {
      attached: node.children.map((child) => toXmindTopic(child)),
    };
  }

  return topic;
}

function sanitizeLabel(text: string) {
  return (text || '').trim();
}

function splitNumberedLines(text: string) {
  return (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function buildExpectedLine(stepIndex: number, expectedLines: string[]) {
  if (expectedLines[stepIndex]) return expectedLines[stepIndex];
  if (expectedLines.length > 0) return expectedLines[0];
  return `期望结果 ${stepIndex + 1}`;
}

function buildRootFromCases(testCases: TestCaseItem[]) {
  const grouped = new Map<string, Map<string, TestCaseItem[]>>();

  for (const item of testCases) {
    const category = sanitizeLabel(item.category) || '功能测试';
    const precondition = sanitizeLabel(item.precondition) || '默认前置条件';
    if (!grouped.has(category)) {
      grouped.set(category, new Map<string, TestCaseItem[]>());
    }
    const preMap = grouped.get(category)!;
    if (!preMap.has(precondition)) {
      preMap.set(precondition, []);
    }
    preMap.get(precondition)!.push(item);
  }

  const categoryTopics = Array.from(grouped.entries()).map(([category, preMap]) => ({
    id: uid(),
    title: `@${category}`,
    children: {
      attached: Array.from(preMap.entries()).map(([precondition, items]) => ({
        id: uid(),
        title: `!${precondition}`,
        children: {
          attached: items.map((it) => {
            const stepLines = splitNumberedLines(it.steps);
            const expectedLines = splitNumberedLines(it.expected);
            const safeSteps = stepLines.length > 0 ? stepLines : ['1. 未提供测试步骤'];

            return {
              id: sanitizeLabel(it.id) || uid(),
              title: sanitizeLabel(it.topic) || '未命名测试',
              priority: it.priority,
              precondition: it.precondition,
              steps: it.steps,
              expected: it.expected,
              markers: [{ markerId: toPriorityMarker(it.priority) }],
              markerRefs: [toPriorityMarker(it.priority)],
              children: {
                attached: [
                  {
                    id: uid(),
                    title: `测试步骤\n${safeSteps.join('\n')}`,
                    children: {
                      attached: [
                        {
                          id: uid(),
                          title: `期望结果\n${(expectedLines.length > 0
                            ? expectedLines
                            : safeSteps.map((_, idx) => buildExpectedLine(idx, expectedLines)
                          )).join('\n')}`,
                        },
                      ],
                    },
                  },
                ],
              },
            };
          }),
        },
      })),
    },
  }));

  return {
    id: 'root',
    title: '@测试用例',
    root: true,
    children: {
      attached: categoryTopics,
    },
  };
}

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = reqSchema.safeParse(raw);

    if (!parsed.success) {
      return NextResponse.json({ error: '请求参数不合法' }, { status: 400 });
    }

    const { mindMap, testCases, title } = parsed.data;
    const sheetTitle = title?.trim() || mindMap.data.text || '测试用例';
    const rootTopic = testCases && testCases.length > 0 ? buildRootFromCases(testCases) : toXmindTopic(mindMap);

    const content = [
      {
        id: uid(),
        class: 'sheet',
        title: sheetTitle,
        rootTopic,
      },
    ];

    const zip = new JSZip();
    zip.file('content.json', JSON.stringify(content, null, 2));
    zip.file('metadata.json', JSON.stringify({ creator: { name: 'next-ai-test-cases' } }, null, 2));

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.xmind.workbook',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(sheetTitle)}.xmind"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
