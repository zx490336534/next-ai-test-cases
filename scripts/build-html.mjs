import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = resolve(root, 'src/app/globals.css');
const output = resolve(root, 'dist');
const [bundle, styles] = await Promise.all([
  build({
    absWorkingDir: root,
    entryPoints: ['src/standalone/main.tsx'],
    alias: { '@/lib/client/runtime': './src/standalone/runtime.ts' },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    target: ['chrome119', 'firefox122', 'safari17.4'],
    define: { 'process.env.NODE_ENV': '"production"' },
    outdir: output,
    write: false,
    minify: true,
    legalComments: 'inline',
  }),
  readFile(source, 'utf8').then((css) => postcss([tailwind({ base: root, optimize: true })]).process(css, { from: source })),
]);
const script = bundle.outputFiles.find(({ path }) => path.endsWith('.js'))?.text;
const canvasCss = bundle.outputFiles.find(({ path }) => path.endsWith('.css'))?.text;
if (!script || !canvasCss) throw new Error('Missing JavaScript or mind map CSS');
const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>AI 测试用例助手 · 单文件版</title>
  <style>${[styles.css, canvasCss].join('\n').replace(/<\/style/gi, '<\\/style')}</style>
</head>
<body>
  <div id="root"></div>
  <noscript>请启用 JavaScript 打开 AI 测试用例助手。</noscript>
  <script>${script.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'next-ai-test-cases.html'), html);
console.log('dist/next-ai-test-cases.html (' + Buffer.byteLength(html).toLocaleString('en') + ' bytes)');
