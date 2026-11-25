import { mkdir, writeFile } from 'node:fs/promises';
import { inlineHtml } from './inline-html.mjs';

const html = await inlineHtml({
  entry: 'src/standalone/main.tsx',
  aliases: { '@/lib/client/runtime': './src/standalone/runtime.ts' },
  title: 'AI 测试用例助手 · 单文件版',
  head: '  <meta name="local-model-gateway" content="">\n',
});
const output = new URL('../dist/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('next-ai-test-cases.html', output), html);
console.log('dist/next-ai-test-cases.html (' + Buffer.byteLength(html).toLocaleString('en') + ' bytes)');
