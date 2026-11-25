import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({
  options: {
    gateway: { type: 'string' },
    file: { type: 'string', default: fileURLToPath(new URL('./next-ai-test-cases.html', import.meta.url)) },
    port: { type: 'string', default: '3025' },
  },
});

let gateway;
const port = Number(options.port);
try {
  gateway = new URL(options.gateway);
  if (!['http:', 'https:'].includes(gateway.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(gateway.hostname)
    || gateway.username || gateway.password || gateway.search || gateway.hash
    || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
} catch {
  console.error('用法：node serve-html.mjs --gateway http://127.0.0.1:3425 [--port 3025] [--file HTML]');
  process.exit(1);
}

const gatewayInput = gateway.href.replace(/\/+$/, '');
const gatewayRoot = gateway.pathname === '/' ? gatewayInput + '/v1' : gatewayInput;
const upstream = gatewayRoot + '/chat/completions';
const host = '127.0.0.1:' + port;
const origin = 'http://' + host;
const marker = '<meta name="local-model-gateway" content="">';

let html;
try {
  html = await readFile(options.file, 'utf8');
  if (!html.includes(marker)) throw new Error();
  const encodedUrl = gatewayInput.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  html = html.replace(marker, () => '<meta name="local-model-gateway" content="' + encodedUrl + '">');
} catch {
  console.error('无法加载 HTML。请将当前版本的 next-ai-test-cases.html 与启动器放在同一目录，或用 --file 指定路径。');
  process.exit(1);
}

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.headers.host !== host) return response.writeHead(403).end();
  if (request.method === 'GET' && request.url === '/') {
    return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    return response.writeHead(404).end();
  }
  const site = request.headers['sec-fetch-site'];
  if (request.headers.origin !== origin || (site && site !== 'same-origin')) {
    return response.writeHead(403).end();
  }
  const authorization = request.headers.authorization;
  if (!authorization || !/^Bearer [\x21-\x7e]+$/.test(authorization)) {
    return response.writeHead(401).end();
  }
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    return response.writeHead(415).end();
  }

  const controller = new AbortController();
  response.on('close', () => controller.abort());
  try {
    const result = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: Readable.toWeb(request),
      duplex: 'half',
      redirect: 'error',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(185_000)]),
    });
    response.writeHead(result.status, {
      'Content-Type': result.headers.get('content-type') ?? 'application/json',
    });
    if (result.body) await pipeline(Readable.fromWeb(result.body), response);
    else response.end();
  } catch {
    if (controller.signal.aborted) return;
    if (!response.headersSent) response.writeHead(502).end();
    else response.destroy();
  }
});
server.on('error', (error) => {
  console.error('本机启动失败（' + error.code + '）。可用 --port 指定另一个端口。');
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log('打开 ' + origin + '/');
  console.log('模型设置的 Base URL：' + gatewayInput + '，请求发送至 ' + gatewayRoot);
});
