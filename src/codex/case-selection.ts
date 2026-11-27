import type { SuiteView } from './contracts';
import type { TestCaseItem } from '../lib/agent/types';

export function setCasesChecked(
  selected: ReadonlySet<string>,
  cases: readonly { id: string }[],
  checked: boolean,
) {
  const next = new Set(selected);
  for (const { id } of cases) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return next;
}

type BoardState = { view?: SuiteView; selectedIds: Set<string>; selectionNotice: string };
type BoardAction =
  | { type: 'view'; view?: SuiteView }
  | { type: 'check'; cases: readonly { id: string }[]; checked: boolean };

const caseFields = ['category', 'topic', 'precondition', 'priority', 'steps', 'expected'] as const satisfies readonly (keyof TestCaseItem)[];

export function boardSelection(state: BoardState, action: BoardAction): BoardState {
  if (action.type === 'check') {
    return { ...state, selectedIds: setCasesChecked(state.selectedIds, action.cases, action.checked), selectionNotice: '' };
  }
  const view = action.view;
  const previous = state.view?.suite;
  const next = view?.suite;
  if (!previous || !next || previous.id !== next.id) {
    return { view, selectedIds: new Set(), selectionNotice: '' };
  }
  if (next.revision < previous.revision) return state;
  if (next.revision === previous.revision || !state.selectedIds.size) return { ...state, view };
  if (previous.context !== next.context) {
    return { view, selectedIds: new Set(), selectionNotice: '执行上下文已更改，请核对后重新选择用例。' };
  }
  const checked = new Map(previous.cases.filter(({ id }) => state.selectedIds.has(id)).map((item) => [item.id, item]));
  const selectedIds = new Set<string>();
  for (const item of next.cases) {
    const original = checked.get(item.id);
    if (original && caseFields.every((field) => original[field] === item[field])) selectedIds.add(item.id);
  }
  const removed = state.selectedIds.size - selectedIds.size;
  const selectionNotice = removed ? `已取消勾选 ${removed} 条已修改或已移除的用例。请核对当前执行范围。` : state.selectionNotice;
  return { view, selectedIds, selectionNotice };
}
