'use client';

import { ArrowUpRight, ChevronRight, Sparkles } from 'lucide-react';
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

export function showSuggestedPrompts(tree: MindMapNode, selection: string | null) {
  const path = selection ? findPath(tree, selection) : null;
  const category = path?.[1]?.data.text.replace(/^@/, '');
  const name = path?.[3]?.data.text;
  const precondition = path?.[2]?.data.text;
  if (category && name) {
    const target = '「' + category + '」里前置条件为「' + precondition + '」的用例「' + name + '」';
    return [
      { label: '检查这条用例', text: '检查' + target + '的前置、步骤和预期是否可执行。先列出发现和建议，保持脑图原样。' },
      { label: '扩展异常场景', text: '根据需求中已经明确的规则，为' + target + '补充有价值的异常或边界场景。保留原用例。' },
      { label: '评估优先级', text: '评估' + target + '的优先级，说明 P0 至 P3 中哪一档合适及理由。保持脑图原样。' },
    ];
  }
  const scope = category ? '只检查「' + category + '」模块' : '审查当前所有模块';
  return [
    { label: '查找覆盖缺口', text: scope + '，按需求中明确的规则找遗漏的主流程、异常或状态切换，先列出建议，保持脑图原样。' },
    { label: '补充边界场景', text: scope + '。根据已有需求补充有明确依据且尚未覆盖的边界用例。无法确定规则的地方先向我提问。' },
    { label: '检查重复和优先级', text: scope + '，找出目的重复或优先级不一致的用例，并说明原因和建议。保持脑图原样。' },
  ];
}

export function ChatSuggestions({ tree, selection, blank, choose }: {
  tree: MindMapNode; selection: string | null; blank: boolean; choose: (text: string) => void;
}) {
  function buttons(items: typeof examples) {
    return (
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {items.map(({ label, text }) => (
          <button type="button" key={label} onClick={() => choose(text)}
            className="flex items-center gap-1 rounded-md border border-[#dce8e7] bg-white px-2.5 py-1.5 text-[11px] text-[#315557] hover:border-[#9dc9c3] hover:bg-[#edf7f5] focus-visible:outline-2 focus-visible:outline-offset-1">
            {label}<ArrowUpRight className="h-3 w-3" aria-hidden="true" />
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
  return (
    <div className="pb-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-[#456469]">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> 猜你想问
      </div>
      {buttons(showSuggestedPrompts(tree, selection))}
    </div>
  );
}
