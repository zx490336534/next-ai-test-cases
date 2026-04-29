import { NextResponse } from 'next/server';
import { z } from 'zod';
import { chatAndUpdateMindMap } from '@/lib/agent/testCaseAgent';
import type { ChatMessage, MindMapNode } from '@/lib/agent/types';

const mindMapNodeDataSchema = z.object({
  text: z.string(),
  uid: z.string().optional(),
  id: z.string().optional(),
  tag: z.array(z.string()).optional(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
}).passthrough();

const mindMapSchema: z.ZodType<MindMapNode> = z.lazy(() =>
  z.object({
    data: mindMapNodeDataSchema,
    children: z.array(mindMapSchema),
  }),
);

const reqSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1),
    }),
  ),
  currentMindMap: mindMapSchema,
});

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: '请先配置 OPENAI_API_KEY' }, { status: 500 });
    }

    const raw = await req.json();
    const parsed = reqSchema.safeParse(raw);

    if (!parsed.success) {
      return NextResponse.json({ error: '请求参数不合法' }, { status: 400 });
    }

    const payload = parsed.data as { messages: ChatMessage[]; currentMindMap: MindMapNode };
    const data = await chatAndUpdateMindMap(payload);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
