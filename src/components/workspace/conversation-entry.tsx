'use client';

import { isToolUIPart } from 'ai';
import { Check, CircleAlert, Loader2, Timer } from 'lucide-react';
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
  return (
    <article aria-label={user ? '你的消息' : 'AI 回复'} className={user ? 'self-end max-w-[92%]' : 'self-start max-w-full'}>
      <div className={user ? 'rounded-xl rounded-br-sm bg-[#daf0eb] px-3 py-2 text-[#173b37]'
        : 'rounded-xl rounded-bl-sm border border-[#e0ebe8] bg-white px-3 py-2 text-[#183637]'}>
        <div className={user ? 'mb-1 text-[11px] text-[#376764]' : 'mb-1 text-[11px] text-slate-500'}>{user ? '你' : 'AI'}</div>
        {tools.length > 0 ? (
          <Trace className="my-1.5">
            {tools.map((part) => {
              const input = part.input as { label?: string } | undefined;
              const output = ('output' in part ? part.output : null) as { detail?: string; state?: string } | null;
              const settled = part.state === 'output-available' || part.state === 'output-error';
              const error = part.state === 'output-error' || !settled && !running;
              const detail = part.state === 'output-error' ? part.errorText : output?.detail;
              const Icon = error || output?.state === 'warning' ? CircleAlert : settled ? Check : Loader2;
              const status = error ? 'error' : settled ? undefined : 'running';
              const line = (
                <TraceLine status={status} className="text-xs">
                  <TraceIcon><Icon className={!settled && !error ? 'animate-spin' : undefined} /></TraceIcon>
                  <TraceTitle>{input?.label ?? '执行步骤'}{error && !settled ? ' · 未完成' : ''}</TraceTitle>
                </TraceLine>
              );
              return detail ? (
                <TraceCollapsible key={part.toolCallId} defaultOpen={running}>
                  <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
                  <TraceCollapsibleContent className="text-xs">{detail}</TraceCollapsibleContent>
                </TraceCollapsible>
              ) : <div key={part.toolCallId}>{line}</div>;
            })}
          </Trace>
        ) : null}
        {text ? <p className="break-words whitespace-pre-wrap text-sm leading-6">{text}</p> : null}
        {execution ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-[#e0ebe8] pt-1.5 text-[11px] tabular-nums text-slate-600">
            <span className="inline-flex items-center gap-1">
              <Timer aria-hidden="true" className="h-3.5 w-3.5" />
              耗时 {execution.elapsedMs < 1000 ? execution.elapsedMs + ' 毫秒' : (execution.elapsedMs / 1000).toFixed(2) + ' 秒'}
            </span>
            <span title={breakdown}>{tokenLabel}</span>
          </div>
        ) : null}
      </div>
    </article>
  );
}
