import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import JSZip from 'jszip';
import { inlineHtml } from './inline-html.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const plugin = 'plugin/codex-test-cases/';
const out = resolve(root, 'dist/codex-test-cases');
const [bundle, board] = await Promise.all([
  build({
    absWorkingDir: root, entryPoints: ['src/codex/start.ts'], bundle: true,
    platform: 'node', format: 'cjs', target: 'node22', write: false, minify: true, legalComments: 'inline',
  }),
  inlineHtml({
    entry: 'src/codex/board.tsx',
    title: '测试用例工作区',
    additionalCss: '\n@source "../codex/**/*.tsx";\n',
  }),
]);
const files = new Map([
  ['.agents/plugins/marketplace.json', await readFile(resolve(root, 'plugin/marketplace.json'))],
  [plugin + 'plugin.json', await readFile(resolve(root, plugin + 'plugin.json'))],
  [plugin + 'mcp.json', await readFile(resolve(root, plugin + 'mcp.json'))],
  [plugin + 'skills/test-case-workbench/SKILL.md', await readFile(resolve(root, plugin + 'skills/test-case-workbench/SKILL.md'))],
  [plugin + 'server/server.cjs', bundle.outputFiles[0].contents],
  [plugin + 'server/board.html', board],
]);
const zip = new JSZip();
for (const [name, data] of files) {
  const path = resolve(out, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  zip.file(name, data);
}
await writeFile(resolve(root, 'dist/codex-test-cases.zip'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log('dist/codex-test-cases.zip');
