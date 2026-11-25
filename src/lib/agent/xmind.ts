import JSZip from 'jszip';
import { z } from 'zod';
import { mindMapSchema, testCaseSchema } from '@/lib/agent/contracts';
import { buildMindMap, normalizeMindMap, readMindMap } from '@/lib/agent/mindMap';
import type { MindMapNode } from '@/lib/agent/types';

export const xmindSchema = z.object({
  mindMap: mindMapSchema,
  testCases: z.array(testCaseSchema).optional(),
  title: z.string().optional(),
});

function toTopic(node: MindMapNode): Record<string, unknown> {
  const priority = node.data.priority;
  return {
    id: node.data.uid || crypto.randomUUID(),
    class: 'topic',
    title: node.data.text,
    ...(priority && { markers: [{ markerId: 'priority-' + (Number(priority[1]) + 1) }] }),
    ...(node.children.length && { children: { attached: node.children.map(toTopic) } }),
  };
}

export async function exportXMind({ mindMap, testCases, title }: z.infer<typeof xmindSchema>) {
  let tree = normalizeMindMap(mindMap);
  if (!tree.children.length && testCases?.length) tree = buildMindMap(testCases);
  if (!readMindMap(tree).cases.length) return Response.json({ error: '脑图中没有可导出的测试用例' }, { status: 400 });
  const sheetTitle = title?.trim() || tree.data.text || '测试用例';
  const zip = new JSZip();
  zip.file('content.json', JSON.stringify([{ id: crypto.randomUUID(), class: 'sheet', title: sheetTitle, rootTopic: toTopic(tree) }]));
  zip.file('metadata.json', JSON.stringify({ creator: { name: 'next-ai-test-cases' } }));
  zip.file('manifest.json', JSON.stringify({ 'file-entries': { 'content.json': {}, 'metadata.json': {} } }));
  return new Response(await zip.generateAsync({ type: 'arraybuffer' }), {
    headers: {
      'Content-Type': 'application/vnd.xmind.workbook',
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(sheetTitle.replace(/['()*]/g, '')),
    },
  });
}
