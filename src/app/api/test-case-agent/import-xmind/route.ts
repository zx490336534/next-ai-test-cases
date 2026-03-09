import JSZip from 'jszip';
import { NextResponse } from 'next/server';
import { z } from 'zod';

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

function getChildren(topic: any): any[] {
  const children = topic?.children;
  if (!children || typeof children !== 'object') return [];

  const result: any[] = [];
  for (const value of Object.values(children)) {
    if (Array.isArray(value)) {
      result.push(...value);
      continue;
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (Array.isArray(obj.topics)) {
        result.push(...obj.topics);
      }
      if (Array.isArray(obj.attached)) {
        result.push(...obj.attached);
      }
    }
  }
  return result.filter((v) => v && typeof v === 'object');
}

function convertTopic(topic: any): MindMapNode {
  const text = typeof topic?.title === 'string' && topic.title.trim() ? topic.title : '未命名节点';
  return {
    data: { text },
    children: getChildren(topic).map((child) => convertTopic(child)),
  };
}

function pickRoot(content: any): any {
  if (Array.isArray(content) && content.length > 0) {
    const sheet = content[0];
    return sheet?.rootTopic || sheet?.topic || sheet;
  }
  return content?.rootTopic || content?.topic || null;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: '缺少上传文件' }, { status: 400 });
    }

    const ab = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(ab);

    const contentJson = zip.file('content.json');
    if (!contentJson) {
      return NextResponse.json(
        { error: '未找到 content.json，请确认是新版 XMind 文件（.xmind）' },
        { status: 400 },
      );
    }

    const raw = await contentJson.async('string');
    const parsed = JSON.parse(raw);
    const rootTopic = pickRoot(parsed);

    if (!rootTopic) {
      return NextResponse.json({ error: 'XMind 内容为空或结构不支持' }, { status: 400 });
    }

    const mindMap = convertTopic(rootTopic);
    const checked = mindMapSchema.safeParse(mindMap);
    if (!checked.success) {
      return NextResponse.json({ error: 'XMind 转换失败，结构不合法' }, { status: 400 });
    }

    return NextResponse.json({
      mindMap: checked.data,
      summary: `已导入 XMind：${file.name}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
