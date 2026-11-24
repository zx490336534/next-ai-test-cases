import { deepStrictEqual } from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chatAndUpdateMindMap } from '../src/lib/agent/chatEdits';
import { buildMindMap, readMindMap } from '../src/lib/agent/mindMap';
import { createModel } from '../src/lib/agent/model';
import { resolveModelSettings } from '../src/lib/agent/modelConfig';
import type { ChatMessage, MindMapNode, TestCaseItem } from '../src/lib/agent/types';
import { loadBaseline } from './baseline.mts';

const item: TestCaseItem = {
  id: '', category: '邀请', precondition: '有效邀请', topic: '正常接受',
  priority: 'P1', steps: '1. 打开邀请并点击接受', expected: '1. 成为团队成员',
};
const tree = buildMindMap([item, { ...item, topic: '邮箱不符', expected: '1. 拒绝加入' },
  { ...item, category: '重置', precondition: '有重置链接', topic: '取消操作', steps: '1. 关闭弹窗', expected: '1. 保持原密码' }]);
const initial = readMindMap(tree).cases;
const samples = [
  { id: 'rename', text: '把邀请模块的“正常接受”改名为“成功加入”，其他保持。', allowed: [0],
    passed: (rows: TestCaseItem[]) => rows[0]?.topic === '成功加入' },
  { id: 'priority', text: '将邀请模块里的“邮箱不符”改为 P0。', allowed: [1],
    passed: (rows: TestCaseItem[]) => rows[1]?.priority === 'P0' },
  { id: 'remove', text: '删除重置模块下的“取消操作”这个用例。', allowed: [2],
    passed: (rows: TestCaseItem[]) => rows.length === 2 && !rows.some(({ topic }) => topic === '取消操作') },
  { id: 'add', text: '在邀请模块的前置条件“有效邀请”下补一个 P1 用例“撤销后拒绝”，管理员先撤销，再点击接受，预期拒绝加入。', allowed: [],
    passed: (rows: TestCaseItem[]) => rows.length === 4 && rows.some(({ topic, expected }) => topic === '撤销后拒绝' && expected.includes('拒绝')) },
  { id: 'update', text: '修改邀请里的“正常接受”：步骤为从邮件打开链接并点击接受，预期成为团队成员且成员列表显示该邮箱，只保留这一步。', allowed: [0],
    passed: (rows: TestCaseItem[]) => rows[0]?.steps.includes('邮件') && rows[0].expected.includes('成员列表') },
  { id: 'clarify', text: '把它改一下。', allowed: [],
    passed: (rows: TestCaseItem[]) => rows.length === 3 },
];

const baseline = await loadBaseline();
const config = resolveModelSettings();
const results: object[] = [];
for (const sample of samples) {
  const input: { currentMindMap: MindMapNode; messages: ChatMessage[] } = {
    currentMindMap: tree, messages: [{ role: 'user', content: sample.text }],
  };
  await Promise.all(['baseline', 'operations'].map(async (variant) => {
    try {
      const result = variant === 'baseline' ? await baseline.chatAndUpdateMindMap(input) : await chatAndUpdateMindMap(createModel(config), input);
      const rows = readMindMap(result.mindMap).cases;
      const remaining = new Map(rows.map((row) => [row.id, row]));
      let collateral = 0;
      for (const [index, before] of initial.entries()) {
        if (!sample.allowed.includes(index)) {
          try { deepStrictEqual(remaining.get(before.id), before); } catch { collateral++; }
        }
      }
      const expectedTotal = initial.length + (sample.id === 'add' ? 1 : sample.id === 'remove' ? -1 : 0);
      if (rows.length > expectedTotal) collateral += rows.length - expectedTotal;
      let exactClarification = true;
      if (sample.id === 'clarify') {
        try { deepStrictEqual(result.mindMap, tree); } catch { exactClarification = false; }
      }
      const record = { id: sample.id, variant, success: !!sample.passed(rows) && exactClarification, collateral };
      results.push(record);
      console.log(record);
    } catch {
      const record = { id: sample.id, variant, success: false, collateral: null };
      results.push(record);
      console.log(record);
    }
  }));
}
await mkdir('.eval-results', { recursive: true });
await writeFile('.eval-results/edits.json', JSON.stringify(results, null, 2), { mode: 0o600 });
