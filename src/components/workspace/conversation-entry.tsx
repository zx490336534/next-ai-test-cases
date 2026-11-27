'use client';

import { isToolUIPart } from 'ai';
import { Check, ChevronRight, CircleAlert, ListChecks, Loader2, Timer } from 'lucide-react';
import { conversationText, type ConversationMessage } from '@/lib/agent/conversation';
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle,
} from '@/components/ui/trace';

export function ConversationEntry({ message, running }: { message: ConversationMessage; running: boolean }) {
  const text = conversationText(message);
  const tools = message.parts.filter(isToolUIPart);
  const user = message.role === 'user';
  const execution = user ? undefined : message.metadata?.execution;
  const usage = execution?.usage;
  const tokenLabel = usage?.calls === 0 ? '0 Token' : usage?.totalTokens !== undefined
    ? (usage.reported < usage.calls ? '部分用量 ' : '') + usage.totalTokens.toLocaleString('zh-CN') + ' Token'
    : 'Token 用量未返回';
  const breakdown = usage?.inputTokens !== undefined && usage.outputTokens !== undefined
    ? '输入 ' + usage.inputTokens.toLocaleString('zh-CN') + ' · 输出 ' + usage.outputTokens.toLocaleString('zh-CN') + ' Token'
    : undefined;
  const hasUnfinishedStep = tools.some((part) => part.state === 'output-error' || (!running && part.state !== 'output-available'));
  return (
    <article aria-label={user ? '你的消息' : 'AI 回复'} className={user ? 'max-w-[94%] min-w-0 self-end' : 'w-full min-w-0 self-start'}>
      <div className={user ? 'rounded-xl rounded-br-sm bg-[#eeedfb] px-3.5 py-2.5 text-[#363451]' : 'text-[#25283d]'}>
        <div className={'mb-1 text-xs font-semibold ' + (user ? 'text-[#57528a]' : 'text-[#5752a3]')}>{user ? '你' : 'AI 助手'}</div>
        {text ? <p className="wrap-anywhere whitespace-pre-wrap text-sm leading-6">{text}</p> : null}
        {tools.length > 0 ? (
          <details className="group/steps mt-2" open={running || hasUnfinishedStep}>
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded text-xs leading-5 text-[#697084] hover:text-[#5752a3] focus-visible:outline-[#5752a3] [&::-webkit-details-marker]:hidden">
              <ListChecks className="size-3.5" aria-hidden="true" />
              执行记录（{tools.length}）
              <ChevronRight className="size-3 group-open/steps:rotate-90" aria-hidden="true" />
            </summary>
            <Trace className="mt-1.5 gap-1 border-s border-[#e0e2ea] ps-2.5">
              {tools.map((part) => {
                const input = part.input as { label?: string } | undefined;
                const output = ('output' in part ? part.output : null) as { detail?: string; state?: string } | null;
                const settled = part.state === 'output-available' || part.state === 'output-error';
                const error = part.state === 'output-error' || !settled && !running;
                const detail = part.state === 'output-error' ? part.errorText : output?.detail;
                const Icon = error || output?.state === 'warning' ? CircleAlert : settled ? Check : Loader2;
                const status = error ? 'error' : settled ? undefined : 'running';
                const line = (
                  <TraceLine status={status} className="gap-1.5 text-xs text-[#697084]">
                    <TraceIcon><Icon className={!settled && !error ? 'motion-safe:animate-spin' : undefined} /></TraceIcon>
                    <TraceTitle>{input?.label ?? '执行步骤'}{error && !settled ? ' · 未完成' : ''}</TraceTitle>
                  </TraceLine>
                );
                return detail ? (
                  <TraceCollapsible key={part.toolCallId} defaultOpen={running}>
                    <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
                    <TraceCollapsibleContent className="ms-0 mt-0.5 border-0 ps-5 text-xs text-[#697084]">{detail}</TraceCollapsibleContent>
                  </TraceCollapsible>
                ) : <div key={part.toolCallId}>{line}</div>;
              })}
            </Trace>
          </details>
        ) : null}
        {execution ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-[#697084]">
            <span className="inline-flex items-center gap-1">
              <Timer aria-hidden="true" className="size-3" />
              耗时 {execution.elapsedMs < 1000 ? execution.elapsedMs + ' 毫秒' : (execution.elapsedMs / 1000).toFixed(2) + ' 秒'}
            </span>
            <span aria-hidden="true">·</span><span title={breakdown}>{tokenLabel}</span>
          </div>
        ) : null}
      </div>
    </article>
  );
}
