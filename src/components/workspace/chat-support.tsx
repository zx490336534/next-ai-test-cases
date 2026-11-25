'use client';

import { ArrowUpRight, ChevronRight, Sparkles } from 'lucide-react';
import type { FollowUp } from '@/lib/agent/follow-ups';
import type { MindMapNode } from '@/lib/agent/types';

const examples = [
  { label: '团队邀请', text: '团队支持邮箱邀请。邀请链接 24 小时后过期。撤销后立即失效，同一邀请只能接受一次。登录邮箱与被邀请邮箱不一致时拒绝加入。' },
  { label: '商品搜索', text: '商品搜索忽略关键字大小写，去除首尾空格。空关键字展示最近浏览。每页最多 20 项，无匹配时显示空结果。' },
  { label: '退款审批', text: '付款后 7 天内可申请退款，累计退款不能超过实付金额。审核通过后的状态为待到账，收到渠道成功回调后才记为已退款。' },
];

function findPath(root: MindMapNode, id: string): MindMapNode[] | null {
  if (root.data.uid === id) return [root];
  for (const child of root.children) {
    const path = findPath(child, id);
    if (path) return [root, ...path];
  }
  return null;
}

function contains(node: MindMapNode, phrase: string): boolean {
  return node.data.text.includes(phrase) || node.children.some((child) => contains(child, phrase));
}

function excerpt(text: string | undefined) {
  return text?.replace(/^\s*\d+[.．、:：)）]\s*/, '').trim().slice(0, 30);
}

export function showSuggestedPrompts(tree: MindMapNode, selection: string | null, followUps: FollowUp[] = []) {
  const path = selection ? findPath(tree, selection) : null;
  const scope = path?.[3] ?? path?.[2] ?? path?.[1];
  const relevant = scope ? followUps.filter(({ anchor }) => contains(scope, anchor)) : followUps;
  if (relevant.length) return relevant.map(({ text }) => ({ label: text, text }));

  const category = path?.[1] ?? tree.children[0];
  const precondition = path?.[2] ?? category?.children.find((group) => group.children.length);
  const item = path?.[3] ?? precondition?.children[0];
  if (!item) return [];

  const step = path?.[4] ?? item.children[0];
  const action = excerpt(step?.data.text);
  const result = excerpt(step?.children[0]?.data.text);
  const title = excerpt(item.data.text);
  const setup = excerpt(precondition?.data.text);
  const options: string[] = [];
  if (action && result && title) {
    options.push('「' + title + '」执行「' + action + '」后，怎么确认「' + result + '」？请补上可观察的判断点。');
  }
  if (title && setup && setup !== '无' && setup !== '无额外前置条件') {
    options.push('如果不满足「' + setup + '」，「' + title + '」该怎么处理？请先核对需求。');
  }
  return options.map((text) => ({ label: text, text }));
}

export function ChatSuggestions({ tree, selection, blank, followUps, choose }: {
  tree: MindMapNode;
  selection: string | null;
  blank: boolean;
  followUps?: FollowUp[];
  choose: (text: string) => void;
}) {
  function buttons(items: typeof examples) {
    return (
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {items.map(({ label, text }) => (
          <button type="button" key={label} title={label} onClick={() => choose(text)}
            className="flex max-w-full min-w-0 items-center gap-1 rounded-md border border-[#dce8e7] bg-white px-2.5 py-1.5 text-[11px] text-[#315557] hover:border-[#9dc9c3] hover:bg-[#edf7f5] focus-visible:outline-2 focus-visible:outline-offset-1">
            <span className="min-w-0 truncate">{label}</span><ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          </button>
        ))}
      </div>
    );
  }
  if (blank) {
    return (
      <details className="group pb-2">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-[#456469]">
          <ChevronRight className="h-3.5 w-3.5 group-open:rotate-90" aria-hidden="true" /> 需求示例
        </summary>
        {buttons(examples)}
      </details>
    );
  }
  const suggestions = showSuggestedPrompts(tree, selection, followUps);
  if (!suggestions.length) return null;
  return (
    <div className="pb-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-[#456469]">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> 猜你想问
      </div>
      {buttons(suggestions)}
    </div>
  );
}
