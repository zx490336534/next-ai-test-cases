import { NextResponse } from 'next/server';
import { z } from 'zod';
import { chatAndUpdateMindMap } from '@/lib/agent/testCaseAgent';

const mindMapSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    data: z.object({ text: z.string() }),
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

    const data = await chatAndUpdateMindMap(parsed.data);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
