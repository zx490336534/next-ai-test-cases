import { priorities } from './contracts';
import type { MindMapNode, TestCaseItem, TestCaseModulePlan } from './types';

type Priority = TestCaseItem['priority'];
export const EMPTY_MAP: MindMapNode = { data: { text: '@测试用例', id: 'root', uid: 'root' }, children: [] };
const preconditionTag = '前置';
const priorityPrefix = /^\s*(?:\[\s*(P[0-3])\s*\]|(P[0-3])(?=\s|[-:：]|$))\s*[-:：]?\s*/i;
const numberPrefix = /^\s*(\d+)\s*[.．、:：)）]\s*/;

function parsePriority(value: string): Priority | undefined {
  return priorities.find((priority) => priority === value.trim().toUpperCase());
}

export function stripCategory(text: string) {
  return text.trim().replace(/^@\s*/, '').trim();
}

function isMapRoot(root: MindMapNode) {
  return root.data.text.trim().startsWith('@') || root.children.some((child) => child.data.text.trim().startsWith('@'));
}

export function normalizeMindMap(root: MindMapNode): MindMapNode {
  const reserved = new Set<string>();
  const seen = new Set<string>();
  function reserve(node: MindMapNode) {
    const id = node.data.uid || node.data.id;
    if (id) reserved.add(id);
    node.children.forEach(reserve);
  }
  reserve(root);
  function visit(node: MindMapNode, depth: number, path: string): MindMapNode {
    const raw = node.data.text.trim();
    const tags = node.data.tag ?? [];
    const isPrecondition = depth === 2 && (tags.includes(preconditionTag) || raw.startsWith('!'));
    const prefix = depth === 3 ? raw.match(priorityPrefix) : null;
    const priority = node.data.priority ?? tags.map(parsePriority).find(Boolean)
      ?? (prefix ? parsePriority(prefix[1] || prefix[2]) : undefined);
    const nextTags = new Set(tags.filter((tag) => !parsePriority(tag) && tag !== preconditionTag));
    if (isPrecondition) nextTags.add(preconditionTag);
    if (priority) nextTags.add(priority);

    let id = node.data.uid || node.data.id;
    if (!id || seen.has(id)) {
      id = path;
      while (reserved.has(id) || seen.has(id)) id += '-';
    }
    seen.add(id);
    const text = (isPrecondition ? raw.replace(/^!\s*/, '') : raw.replace(prefix?.[0] ?? /$^/, '')) || raw;
    const children = depth === 3 ? migrateLegacySteps(node.children, id) : node.children;
    return {
      data: { text, uid: id, id, ...(priority && { priority }), ...(nextTags.size && { tag: [...nextTags] }) },
      children: children.map((child, index) => visit(child, depth + 1, path + '-' + (index + 1))),
    };
  }
  return visit(root, isMapRoot(root) ? 0 : 1, 'root');
}

function numberedLines(value: string) {
  return value.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
}

export function validateCaseContent<T extends Pick<TestCaseItem, 'topic' | 'steps' | 'expected'>>(item: T): T {
  const steps = numberedLines(item.steps);
  const expected = numberedLines(item.expected);
  const parseLine = (line: string) => {
    const match = line.match(numberPrefix);
    return { number: match ? Number(match[1]) : undefined, body: line.replace(numberPrefix, '').trim() };
  };
  const stepRows = steps.map(parseLine);
  const expectedRows = expected.map(parseLine);
  const paired = stepRows.length > 0 && stepRows.length === expectedRows.length
    && stepRows.every(({ body, number }, index) => {
      const result = expectedRows[index];
      return body && result.body && (number === undefined || number === index + 1)
        && (result.number === undefined || result.number === index + 1);
    });
  if (!paired || !item.topic.trim() || expectedRows.some(({ body }) => /^(期望结果\s*\d*|符合预期|系统返回与需求一致的结果)[。.]?$/.test(body))) {
    throw new Error('用例的步骤和可观察的预期结果必须逐条配对');
  }
  const format = (rows: typeof stepRows) => rows.map(({ body }, index) => (index + 1) + '. ' + body).join('\n');
  return { ...item, steps: format(stepRows), expected: format(expectedRows) };
}

function node(text: string, id: string, children: MindMapNode[] = [], extra: Partial<MindMapNode['data']> = {}): MindMapNode {
  return { data: { text, uid: id, id, ...extra }, children };
}

function resultsAlign(steps: string[], expected: string[]) {
  return steps.length === expected.length && steps.every((step, index) => {
    const number = step.match(numberPrefix)?.[1];
    const resultNumber = expected[index].match(numberPrefix)?.[1];
    return !number || !resultNumber || number === resultNumber;
  });
}

function buildStepNodes(steps: string[], expected: string[], id: string) {
  return steps.map((step, index) => {
    const position = index + 1;
    return node(step, id + '-step-' + position, expected[index]
      ? [node(expected[index], id + '-expected-' + position)]
      : []);
  });
}

export function buildCaseNode(item: Pick<TestCaseItem, 'topic' | 'priority' | 'steps' | 'expected'>, id: string) {
  const steps = numberedLines(item.steps);
  const expected = numberedLines(item.expected);
  // Preserve the original grouping of older exports with ambiguous pairs.
  const children = expected.length && !resultsAlign(steps, expected)
    ? [node('测试步骤\n' + item.steps, id + '-steps', [node('期望结果\n' + item.expected, id + '-expected')])]
    : buildStepNodes(steps, expected, id);
  return node(item.topic, id, children, { priority: item.priority, tag: [item.priority] });
}

export function buildCategoryNode(title: string, id: string, cases: TestCaseItem[] = [], caseId?: (item: TestCaseItem) => string) {
  const groups = new Map<string, TestCaseItem[]>();
  for (const item of cases) {
    const name = item.precondition.trim().replace(/^!\s*/, '') || '无';
    const group = groups.get(name) ?? [];
    group.push(item);
    groups.set(name, group);
  }
  const children = [...groups].map(([name, items], index) => {
    const preId = id + '-pre-' + (index + 1);
    return node(name, preId, items.map((item, caseIndex) => buildCaseNode(item, caseId?.(item) ?? preId + '-case-' + (caseIndex + 1))), { tag: [preconditionTag] });
  });
  return node('@' + stripCategory(title), id, children);
}

export function buildMindMap(cases: TestCaseItem[], caseId?: (item: TestCaseItem) => string): MindMapNode {
  const groups = new Map<string, TestCaseItem[]>();
  for (const item of cases) {
    const name = stripCategory(item.category) || '未分类';
    const group = groups.get(name) ?? [];
    group.push(item);
    groups.set(name, group);
  }
  return { ...EMPTY_MAP, children: [...groups].map(([name, items], index) => buildCategoryNode(name, 'module-' + (index + 1), items, caseId)) };
}

export function buildSkeleton(modules: TestCaseModulePlan[]) {
  return { ...EMPTY_MAP, children: modules.map(({ id, title }) => buildCategoryNode(title, id)) };
}

function readDetail(text: string, label: string) {
  const lines = text.replace(/\r/g, '').split('\n');
  const heading = lines[0].trim().match(new RegExp('^' + label + '(?:\\s*\\d+)?(?:\\s*[:：-]\\s*(.*))?$'));
  return heading ? [heading[1], ...lines.slice(1)].filter(Boolean).join('\n').trim() : null;
}

function migrateLegacySteps(children: MindMapNode[], id: string) {
  const [group, sibling] = children;
  if (!group || children.length > 2) return children;
  const [nested] = group.children;
  const expectedGroup = nested ?? sibling;
  if (!expectedGroup || (nested && (sibling || group.children.length !== 1)) || expectedGroup.children.length) return children;
  const stepsText = readDetail(group.data.text, '测试步骤');
  const expectedText = readDetail(expectedGroup.data.text, '期望结果');
  if (!stepsText || expectedText === null) return children;
  const steps = numberedLines(stepsText);
  const expected = numberedLines(expectedText);
  if (!resultsAlign(steps, expected)) return children;
  return buildStepNodes(steps, expected, id);
}

export function readMindMap(root: MindMapNode) {
  const categories = isMapRoot(root) ? root.children : [root];
  const cases: TestCaseItem[] = [];
  let preconditions = 0;
  for (const category of categories) {
    for (const precondition of category.children) {
      preconditions++;
      for (const test of precondition.children) {
        const steps: string[] = [];
        const expected: string[] = [];
        for (const child of test.children) {
          const step = readDetail(child.data.text, '测试步骤');
          if (step !== null) {
            steps.push(step);
            for (const nested of child.children) {
              const result = readDetail(nested.data.text, '期望结果');
              if (result !== null) expected.push(result);
            }
          } else {
            const result = readDetail(child.data.text, '期望结果');
            if (result !== null) {
              expected.push(result);
            } else if (child.data.text.trim()) {
              steps.push(child.data.text);
              expected.push(child.children.map((item) => item.data.text).filter(Boolean).join('\n'));
            }
          }
        }
        if (!test.data.text.trim() || (!test.data.priority && !steps.length && !expected.length)) continue;
        cases.push({
          id: test.data.uid ?? test.data.id ?? '',
          category: stripCategory(category.data.text) || '未分类',
          precondition: precondition.data.text || '无',
          topic: test.data.text,
          priority: test.data.priority ?? 'P2',
          steps: steps.join('\n'),
          expected: expected.join('\n'),
        });
      }
    }
  }
  return { cases, categories: categories.length, preconditions };
}

export function toCsv(cases: TestCaseItem[]) {
  function cell(value: string) {
    const literal = /^[\s\uFEFF]*[=+\-@\t\r\n＝＋－＠]/.test(value) ? "'" + value : value;
    return '"' + literal.replace(/"/g, '""') + '"';
  }
  const rows = cases.map((item) => [
    item.category + '-' + item.topic, item.priority, item.precondition, item.steps, item.expected,
  ].map(cell).join(','));
  return '\uFEFF' + ['测试名称,优先级,前置条件,测试步骤,期望结果', ...rows].join('\r\n');
}
