'use client';

import { workspaceFetch } from '@/lib/client/runtime';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useCallback, useMemo, useRef, useState } from 'react';
import { conversationText, type ConversationMessage, type RetryRequest } from '@/lib/agent/conversation';
import type { Extensions } from '@/lib/agent/extensionContracts';
import { normalizeMindMap, readMindMap, toCsv } from '@/lib/agent/mindMap';
import type { ModelSettings } from '@/lib/agent/modelConfig';
import type { MindMapNode } from '@/lib/agent/types';
import type { SavedWorkspace } from '@/lib/workspaces/types';

type Pending = { retry: RetryRequest; extensions: Extensions; errors: string[] };
type Run = { incomplete?: ConversationMessage; staleReply?: ConversationMessage; staleEdit?: boolean; startedAt: number; extensions: Extensions; atRevision: number; requirement: string; previous?: Pending; pending: Pending | null };

function download(blob: Blob, name: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export function useCaseWorkspace(
  session: SavedWorkspace, settings: ModelSettings, extensions: Extensions,
  readEditor: () => MindMapNode | undefined, isEditorEditing: () => boolean,
) {
  const [mindMap, setMindMap] = useState(() => normalizeMindMap(session.mindMap));
  const [mode, setMode] = useState<'generate' | 'chat' | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [retry, setRetry] = useState<Pending | null>(null);
  const [exporting, setExporting] = useState(false);
  const active = useRef<Run | null>(null);
  const mapRef = useRef(mindMap);
  const revision = useRef(0);

  const commitMap = useCallback((next: MindMapNode) => {
    const normalized = normalizeMindMap(next);
    if (JSON.stringify(normalized) === JSON.stringify(mapRef.current)) return;
    mapRef.current = normalized;
    revision.current++;
    setMindMap(normalized);
  }, []);
  const { cases } = useMemo(() => readMindMap(mindMap), [mindMap]);
  const priorities = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const row of cases) priorities[row.priority]++;

  const transport = useMemo(() => new DefaultChatTransport<ConversationMessage>({
    api: '/api/test-case-agent/conversation',
    fetch: workspaceFetch,
    prepareSendMessagesRequest({ body, messages }) {
      const transcript = messages.filter(({ role }) => role !== 'system')
        .map((message) => ({ role: message.role, content: conversationText(message) }))
        .filter(({ content }) => content);
      const original = transcript.find(({ role }) => role === 'user');
      const originalRequirement = original && original.content.length <= 40_000 && !transcript.slice(-12).includes(original)
        ? original.content : undefined;
      return { body: { ...body, messages: transcript.slice(-20), originalRequirement } };
    },
  }), []);

  const chat = useChat<ConversationMessage>({
    id: session.id,
    messages: session.messages,
    transport,
    onError(err) {
      let message = err.message;
      try { message = JSON.parse(message).error ?? message; } catch { /* Transport errors are plain text. */ }
      setError(message);
    },
    onFinish({ message, isAbort, isError, isDisconnect }) {
      const run = active.current;
      if (!run) return;
      if (run.staleEdit) run.staleReply = message;
      if (message.metadata?.execution || !(isAbort || isError || isDisconnect)) return;
      run.incomplete = message;
    },
    onData(part) {
      const run = active.current;
      if (!run || part.type !== 'data-workspace') return;
      const event = part.data;
      switch (event.type) {
        case 'progress': setProgress(event.message); break;
        case 'warning': setWarning(event.message); break;
        case 'plan':
          run.pending = {
            retry: { requirement: run.requirement, plan: {
              modules: event.modules, sourceHash: event.sourceHash,
              failedIds: run.previous?.retry.plan.failedIds ?? event.modules.map(({ id }) => id),
            } },
            extensions: run.extensions,
            errors: [],
          };
          if (!run.previous) commitMap(event.mindMap);
          break;
        case 'module': {
          const current = mapRef.current;
          commitMap({ ...current, children: current.children.map((node) => node.data.uid === event.id && !node.children.length
            ? { ...event.mindMap, data: node.data } : node) });
          if (run.pending) run.pending.retry.plan.failedIds = run.pending.retry.plan.failedIds.filter((id) => id !== event.id);
          break;
        }
        case 'module-error': run.pending?.errors.push(event.message); break;
        case 'complete': if (event.mindMap) commitMap(event.mindMap); break;
        case 'error': setError(event.message); break;
        case 'edit': {
          const current = readEditor();
          if (current) commitMap(current);
          if (isEditorEditing() || revision.current !== run.atRevision) {
            run.staleEdit = true;
            setError('等待回复期间脑图已编辑。本次建议未应用，请重新发送指令。');
          } else commitMap(event.mindMap);
          break;
        }
      }
    },
  });

  async function send(text: string, previous?: Pending, selectedNodeId?: string) {
    if (active.current || !text.trim()) return;
    const current = readEditor();
    if (current) commitMap(current);
    const requirement = previous?.retry.requirement ?? text;
    const run: Run = {
      startedAt: performance.now(),
      extensions: previous?.extensions ?? extensions,
      atRevision: revision.current,
      requirement,
      previous,
      pending: previous ? { ...previous, retry: { ...previous.retry, plan: { ...previous.retry.plan } }, errors: [] } : null,
    };
    active.current = run;
    const generating = !!previous || !mapRef.current.children.length;
    if (generating && !previous) setRetry(null);
    setMode(generating ? 'generate' : 'chat');
    setProgress('');
    setError('');
    setWarning('');
    try {
      await chat.sendMessage({ text }, { body: { settings, extensions: run.extensions, currentMindMap: mapRef.current, selectedNodeId, retry: previous?.retry } });
    } catch {
      setError('对话连接中断，请稍后重试。');
    } finally {
      const stale = run.staleReply;
      if (stale?.metadata?.followUps) {
        chat.setMessages((messages) => messages.map((message) => message.id === stale.id
          ? { ...message, metadata: { ...message.metadata, followUps: undefined } } : message));
      }
      if (run.incomplete) {
        const elapsedMs = Math.round(performance.now() - run.startedAt);
        const finished = { ...run.incomplete, metadata: { ...run.incomplete.metadata, execution: { elapsedMs } } };
        chat.setMessages((messages) => messages.some(({ id }) => id === finished.id)
          ? messages.map((item) => item.id === finished.id ? finished : item)
          : [...messages, finished]);
      }
      if (run.pending?.retry.plan.failedIds.length) setRetry(run.pending);
      else if (previous || !mapRef.current.children.length) setRetry(null);
      active.current = null;
      setMode(null);
    }
  }

  function exportCsv() {
    const current = readEditor();
    if (current) commitMap(current);
    const rows = readMindMap(mapRef.current).cases;
    if (!rows.length) { setError('当前脑图里没有可导出的用例'); return; }
    download(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' }), 'test-cases.csv');
  }

  async function exportXmind() {
    const current = readEditor();
    if (current) commitMap(current);
    if (!readMindMap(mapRef.current).cases.length) { setError('当前脑图里没有可导出的用例'); return; }
    setExporting(true);
    try {
      const result = await workspaceFetch('/api/test-case-agent/export-xmind', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mindMap: mapRef.current }),
      });
      if (!result.ok) throw new Error((await result.json().catch(() => null))?.error ?? 'XMind 导出失败');
      download(await result.blob(), 'test-cases.xmind');
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }

  return {
    mindMap, commitMap, messages: chat.messages, send: (text: string, selectedNodeId?: string) => send(text, undefined, selectedNodeId), progress, mode,
    error, setError, warning, retry, exporting, exportCsv, exportXmind,
    stats: { caseCount: cases.length, priorities },
    retryFailed: () => retry && send('重试未完成的模块', retry),
    cancel: () => { void chat.stop(); setError('已停止，当前脑图仍保留。'); },
  };
}
