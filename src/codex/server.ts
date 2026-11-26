import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSuiteInput, editSuiteInput, recordRunInput, runId, startRunInput, suiteId } from './contracts';
import { openCaseStore, WorkspaceError } from './store';

const resourceUri = 'ui://test-case-workbench/board.html';
const render = { ui: { resourceUri } };
const local = { openWorldHint: false };

function result(action: () => Record<string, unknown>, description: string) {
  try {
    return { content: [{ type: 'text' as const, text: description }], structuredContent: action() };
  } catch (error) {
    const text = error instanceof WorkspaceError ? error.message : '无法读写本地用例工作区';
    return { content: [{ type: 'text' as const, text }], isError: true };
  }
}

export function createCaseServer(store: ReturnType<typeof openCaseStore>, boardHtml: string) {
  const server = new McpServer({ name: 'test-case-workbench', version: '0.1.1' });
  registerAppResource(server, '用例脑图', resourceUri, {}, async () => ({
    contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: boardHtml }],
  }));

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
    description: '读取指定工作区的当前版本、需求、上下文、全部用例和最新批次，并展示脑图。',
    inputSchema: { suiteId },
    annotations: { ...local, readOnlyHint: true },
    _meta: render,
  }, ({ suiteId }) => result(() => store.open(suiteId), '已打开用例工作区。'));

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
    description: '回写当前执行批次的实际用例结果和证据，只接受批次内的 ID。相同结果可安全重试。',
    inputSchema: recordRunInput,
    annotations: { ...local, destructiveHint: false, idempotentHint: true },
  }, (input) => result(() => ({ run: store.record(input) }), '已记录执行结果。'));

  return server;
}

export async function main() {
  const stateDir = join(homedir(), '.codex', 'test-case-workbench');
  const path = resolve(process.env.CODEX_TEST_CASE_DB || join(stateDir, 'library.sqlite'));
  const boardHtml = readFileSync(join(__dirname, 'board.html'), 'utf8');
  const store = openCaseStore(path);
  const server = createCaseServer(store, boardHtml);
  server.server.onclose = () => store.close();
  try {
    await server.connect(new StdioServerTransport());
  } catch (error) {
    store.close();
    throw error;
  }
}
