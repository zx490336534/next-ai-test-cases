import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const [command, ...args] = process.argv.slice(2);
if (!['dev', 'start'].includes(command) ||
    (args.length && !(args.length === 2 && ['-p', '--port'].includes(args[0]) && /^\d+$/.test(args[1])))) {
  console.error('Usage: pnpm dev:local | pnpm start:local [-p PORT]');
  process.exit(1);
}
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), command, '--hostname', '127.0.0.1', ...args], {
  stdio: 'inherit',
  env: { ...process.env, TEST_CASES_LOOPBACK: '1' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
