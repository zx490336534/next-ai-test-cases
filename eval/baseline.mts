import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ChatMessage, MindMapChatResult, MindMapNode, ModuleTestCaseResult, TestCaseModulePlan, TestCasePlanResult } from '../src/lib/agent/types';

const baselineSha = 'ea6b411';

export async function loadBaseline() {
  const directory = resolve('.eval-results', 'baseline-source');
  const marker = join(directory, '.ready');
  if (await readFile(marker, 'utf8').catch(() => null) !== baselineSha) {
    await mkdir(join(directory, 'src/lib/agent'), { recursive: true });
    for (const file of ['package.json', 'pnpm-lock.yaml', 'src/lib/agent/testCaseAgent.ts', 'src/lib/agent/types.ts']) {
      await writeFile(join(directory, file), execFileSync('git', ['show', baselineSha + ':' + file]));
    }
    execFileSync('pnpm', ['--dir', directory, '--registry=https://registry.npmjs.org', 'install', '--frozen-lockfile', '--ignore-scripts'], { stdio: 'ignore' });
    await writeFile(marker, baselineSha);
  }
  return import(pathToFileURL(join(directory, 'src/lib/agent/testCaseAgent.ts')).href) as Promise<{
    planTestCaseModules: (requirement: string) => Promise<TestCasePlanResult>;
    generateModuleTestCases: (input: { requirement: string; module: TestCaseModulePlan; modules: TestCaseModulePlan[] }) => Promise<ModuleTestCaseResult>;
    chatAndUpdateMindMap: (input: { messages: ChatMessage[]; currentMindMap: MindMapNode }) => Promise<MindMapChatResult>;
  }>;
}
