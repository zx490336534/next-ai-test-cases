import { version as pluginVersion } from '../../plugin/codex-test-cases/plugin.json';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { appendCasesInput, createSuiteInput, editSuiteInput, recordRunInput, runId, startRunInput, suiteId } from './contracts';
import { writeBoardFile } from './board-file';
import { openCaseStore, WorkspaceError } from './store';

const resourceUri = 'ui://test-case-workbench/board.html';
const render = { ui: { resourceUri } };
const local = { openWorldHint: false };

function result(action: () => Record<string, unknown>, description: string | ((data: Record<string, unknown>) => string)) {
  try {
    const data = action();
    const text = typeof description === 'string' ? description : description(data);
    return { content: [{ type: 'text' as const, text }], structuredContent: data };
  } catch (error) {
    const text = error instanceof WorkspaceError ? error.message : '无法读写本地用例工作区';
    return { content: [{ type: 'text' as const, text }], isError: true };
  }
}

export function createCaseServer(store: ReturnType<typeof openCaseStore>, boardHtml: string) {
  const server = new McpServer({ name: 'test-case-workbench', version: pluginVersion });
  registerAppResource(server, '用例脑图', resourceUri, {}, async () => ({
    contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: boardHtml }],
  }));

  registerAppTool(server, 'workbench_panel', {
    title: '测试用例脑图',
    description: '在当前 Codex 聊天的侧边面板选择和打开一个本地测试用例工作区。',
    annotations: { ...local, readOnlyHint: true },
    _meta: {
      ui: { resourceUri, visibility: ['app'] },
      'openai/ui': { entrypoints: [{ type: 'thread' }] },
    },
  }, () => result(() => ({ suites: store.list() }), '请选择要打开的用例工作区。'));

  server.registerTool('list_suites', {
    description: '列出最近使用的本地测试用例工作区。根据标题和 ID 恢复会话上下文。',
    annotations: { ...local, readOnlyHint: true },
  }, () => result(() => ({ suites: store.list() }), '已读取工作区列表。'));

  registerAppTool(server, 'create_suite', {
    description: '将当前需求、项目上下文和 Codex 生成的可执行用例保存为新工作区，并展示脑图。每条步骤必须有一个可观察预期。',
    inputSchema: createSuiteInput,
    annotations: { ...local, destructiveHint: false },
    _meta: render,
  }, (input) => result(() => store.create(input), '已保存用例工作区。'));

  registerAppTool(server, 'open_suite', {
    description: '读取工作区、全部用例和最近执行结果，提供交互脑图。侧边入口为「测试用例脑图」。',
    inputSchema: { suiteId },
    annotations: { ...local, readOnlyHint: true },
    _meta: render,
  }, ({ suiteId }) => result(() => store.open(suiteId), '已读取工作区。可在当前聊天的「测试用例脑图」侧边面板查看。'));

  server.registerTool('append_cases', {
    description: '将新增用例追加到同一工作区，只添加用例。返回工作区 ID、最新版本和总条数。',
    inputSchema: appendCasesInput,
    annotations: { ...local, destructiveHint: false },
  }, ({ suiteId, revision, cases }) => result(() => {
    const { suite } = store.update({
      suiteId, revision, changes: cases.map((entry) => ({ action: 'add', entry })),
    });
    return { suiteId: suite.id, revision: suite.revision, count: suite.cases.length };
  }, (data) => '已追加用例。工作区 ' + data.suiteId + '，版本 ' + data.revision + '，共 ' + data.count + ' 条。'));

  registerAppTool(server, 'update_suite', {
    description: '按稳定用例 ID 增加、修改或移除指定用例，也可修改需求、标题和项目上下文。提交最近读取的版本，冲突请重新读取。',
    inputSchema: editSuiteInput,
    annotations: { ...local, destructiveHint: true },
    _meta: render,
  }, (input) => result(() => store.update(input), '已保存工作区修改。'));

  server.registerTool('start_run', {
    description: '为用户明确指定的用例和环境创建执行批次。返回锁定的用例步骤、预期和上下文。随后由 Codex 使用可用工具逐项执行并回写观察结果。',
    inputSchema: startRunInput,
    annotations: { ...local, destructiveHint: false },
  }, (input) => result(() => store.startRun(input), '已冻结执行范围。请基于该批次返回的步骤执行。'));

  server.registerTool('get_run', {
    description: '读取指定执行批次的用例快照、目标和结果，用于继续执行未记录的用例。',
    inputSchema: { suiteId, runId },
    annotations: { ...local, readOnlyHint: true },
  }, ({ suiteId, runId }) => result(() => ({ run: store.getRun(suiteId, runId) }), '已读取执行批次。'));

  server.registerTool('record_run_results', {
    description: '回写执行结果和证据，返回本次确认的用例 ID、累计已记录数和批次总数。相同结果可安全重试，完整步骤和证据可用 get_run 读取。',
    inputSchema: recordRunInput,
    annotations: { ...local, destructiveHint: false, idempotentHint: true },
  }, (input) => result(() => {
    const run = store.record(input);
    return {
      suiteId: run.suiteId, runId: run.id, caseIds: [...new Set(input.outcomes.map(({ caseId }) => caseId))],
      recorded: run.outcomes.length, total: run.cases.length,
    };
  }, (receipt) => '已记录 ' + receipt.recorded + '/' + receipt.total + ' 条用例。'));

  return server;
}

export async function main(args = process.argv.slice(2)) {
  const stateDir = join(homedir(), '.codex', 'test-case-workbench');
  const path = resolve(process.env.CODEX_TEST_CASE_DB || join(stateDir, 'library.sqlite'));
  const boardDirectory = join(dirname(path), 'boards');
  const boardHtml = readFileSync(join(__dirname, 'board.html'), 'utf8');
  const store = openCaseStore(path);
  if (args.length) {
    try {
      if (args.length === 2 && args[0] === '--export-board') {
        const view = store.open(suiteId.parse(args[1]));
        const boardPath = writeBoardFile(boardDirectory, boardHtml, view);
        console.log(JSON.stringify({ boardPath, count: view.suite.cases.length, suiteId: view.suite.id, revision: view.suite.revision }));
        return;
      }
      if (args[0] === '--tool' && args[1] && (args.length === 2 || args.length === 4 && args[2] === '--input')) {
        const input = args[3] === undefined ? {} : JSON.parse(readFileSync(args[3] === '-' ? 0 : args[3], 'utf8'));
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WorkspaceError('工具参数须为 JSON 对象');
        const server = createCaseServer(store, boardHtml);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'test-case-workbench-cli', version: pluginVersion });
        try {
          await server.connect(serverTransport);
          await client.connect(clientTransport);
          const response = await client.callTool({ name: args[1], arguments: input });
          console.log(JSON.stringify(response));
          if (response.isError) process.exitCode = 1;
        } finally {
          await client.close();
          await server.close();
        }
        return;
      }
      throw new WorkspaceError('用法：--export-board <工作区 ID> ｜ --tool <名称> [--input <文件或 ->]');
    } finally {
      store.close();
    }
  }
  const server = createCaseServer(store, boardHtml);
  server.server.onclose = () => store.close();
  try {
    await server.connect(new StdioServerTransport());
  } catch (error) {
    store.close();
    throw error;
  }
}
