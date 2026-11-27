'use client';

import { ArrowUpLeft, ChevronRight } from 'lucide-react';
import type { FollowUp } from '@/lib/agent/follow-ups';
import type { MindMapNode } from '@/lib/agent/types';

export const requirementExamples = [
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
  if (blank) {
    return (
      <details className="group mb-2">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded text-xs font-medium text-[#697084] hover:text-[#5752a3] focus-visible:outline-[#5752a3] [&::-webkit-details-marker]:hidden">
          需求示例 <ChevronRight className="size-3.5 group-open:rotate-90" aria-hidden="true" />
        </summary>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {requirementExamples.map(({ label, text }) => (
            <button type="button" key={label} onClick={() => choose(text)}
              className="rounded-md bg-[#f3f3f8] px-2.5 py-1.5 text-xs text-[#4d5068] hover:bg-[#eeedfb] hover:text-[#454080] focus-visible:outline-[#5752a3]">{label}</button>
          ))}
        </div>
      </details>
    );
  }
  const suggestions = showSuggestedPrompts(tree, selection, followUps);
  if (!suggestions.length) return null;
  return (
    <section aria-label="猜你想问" className="mb-2.5">
      <h3 className="mb-1 text-xs font-medium text-[#697084]">猜你想问</h3>
      <div className="grid gap-0.5">
        {suggestions.map(({ label, text }) => (
          <button type="button" key={label} title={label} onClick={() => choose(text)}
            className="group flex min-w-0 items-start gap-1.5 rounded py-0.5 text-start text-xs leading-5 text-[#514c91] hover:underline focus-visible:outline-[#5752a3]">
            <ArrowUpLeft className="mt-1 size-3 shrink-0" aria-hidden="true" />
            <span className="line-clamp-2 min-w-0 wrap-anywhere group-focus-visible:line-clamp-none group-hover:line-clamp-none">{label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
