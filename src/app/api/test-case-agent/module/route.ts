import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateModuleTestCases } from '@/lib/agent/testCaseAgent';

const moduleSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  riskPoints: z.array(z.string()),
});

const reqSchema = z.object({
  requirement: z.string().min(1),
  module: moduleSchema,
  modules: z.array(moduleSchema),
});

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = reqSchema.safeParse(raw);

    if (!parsed.success) {
      return NextResponse.json({ error: '请求参数不合法' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: '请先配置 OPENAI_API_KEY' }, { status: 500 });
    }

    const data = await generateModuleTestCases(parsed.data);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
