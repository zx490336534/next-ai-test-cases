import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { inlineHtml } from './inline-html.mjs';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const html = await inlineHtml({
  entry: 'src/standalone/main.tsx',
  aliases: { '@/lib/client/runtime': './src/standalone/runtime.ts' },
  title: '测试用例工作台 · 单文件版',
  head: '  <meta name="generator" content="next-ai-test-cases ' + version + '">\n  <meta name="local-model-gateway" content="">\n',
});
const output = new URL('../dist/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('next-ai-test-cases.html', output), html);
console.log('dist/next-ai-test-cases.html (' + Buffer.byteLength(html).toLocaleString('en') + ' bytes)');
