import { NextResponse } from 'next/server';
import { planTestCaseModules } from '@/lib/agent/testCaseAgent';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const requirement = (body?.requirement || '').trim();

    if (!requirement) {
      return NextResponse.json({ error: 'requirement 不能为空' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: '请先配置 OPENAI_API_KEY' }, { status: 500 });
    }

    const data = await planTestCaseModules(requirement);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
