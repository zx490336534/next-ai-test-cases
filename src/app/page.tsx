'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Download,
  Expand,
  FileArchive,
  Loader2,
  Ellipsis,
  Maximize2,
  MessageSquare,
  PanelRightClose,
  Plus,
  Workflow,
  Minimize2,
  Redo2,
  RefreshCw,
  Scan,
  Send,
  Shrink,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { NodeSearch } from '@/components/mindmap/node-search';
import { MindMapView, type MindMapViewHandle } from '@/components/mindmap/mindmap-view';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ConversationEntry } from '@/components/workspace/conversation-entry';
import { ChatSuggestions } from '@/components/workspace/chat-support';
import { ModelSettingsDialog, readSavedSettings } from '@/components/workspace/model-settings';
import { WorkspaceExtensions } from '@/components/workspace/workspace-extensions';
import { useCaseWorkspace } from '@/components/workspace/use-case-workspace';
import { SessionHistory } from '@/components/workspace/session-history';
import { WorkspacePanels, WorkspaceViews, useCompactWorkspace, type WorkspaceView } from '@/components/workspace/workspace-panels';
import { sessionRequest } from '@/components/workspace/session-client';
import { useSessionSave } from '@/components/workspace/use-session-save';
import { standalone } from '@/lib/client/runtime';
import { normalizeMindMap } from '@/lib/agent/mindMap';
import type { Extensions, TextSkill } from '@/lib/agent/extensionContracts';
import type { ModelSettings } from '@/lib/agent/modelConfig';
import type { RemovedWorkspace, SavedWorkspace, WorkspaceSummary } from '@/lib/workspaces/types';

const sessionKey = 'next-ai-test-cases:open-session';

export default function Page() {
  const [history, setHistory] = useState<WorkspaceSummary[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [session, setSession] = useState<SavedWorkspace | null>(null);
  const [settings, setSettings] = useState<ModelSettings>({});
  const [extensions, setExtensions] = useState<Extensions>({});
  const [skillLibrary, setSkillLibrary] = useState<TextSkill[]>([]);
  const [initialError, setInitialError] = useState('');
  const [attempt, setAttempt] = useState(0);

  const remember = useCallback(({ id, title, updatedAt }: WorkspaceSummary, insert = false) => {
    const summary = { id, title, updatedAt };
    setHistory((items) => items.some((item) => item.id === id)
      ? items.map((item) => item.id === id && item.updatedAt <= updatedAt ? summary : item)
      : insert ? [summary, ...items] : items);
  }, []);

  const select = useCallback((value: SavedWorkspace) => {
    try { sessionStorage.setItem(sessionKey, value.id); } catch { /* Storage can be disabled. */ }
    remember(value, true);
    setSession(value);
  }, [remember]);

  useEffect(() => {
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => setSettings(readSavedSettings()));
    async function load() {
      const options = { signal: controller.signal };
      try {
        const list = await sessionRequest<WorkspaceSummary[]>(undefined, options);
        let lastId: string | null = null;
        try { lastId = sessionStorage.getItem(sessionKey); } catch { /* Storage can be disabled. */ }
        const id = list.find((item) => item.id === lastId)?.id ?? list[0]?.id;
        const current = id ? await sessionRequest<SavedWorkspace>(id, options)
          : await sessionRequest<SavedWorkspace>(undefined, { ...options, method: 'POST' });
        if (!controller.signal.aborted) { setHistory(list); select(current); }
      } catch (cause) {
        if (!controller.signal.aborted) setInitialError(cause instanceof Error ? cause.message : '无法打开会话');
      }
    }
    void load();
    return () => {
      controller.abort();
      cancelAnimationFrame(frame);
    };
  }, [attempt, select]);

  async function openSession(id?: string) {
    select(await sessionRequest<SavedWorkspace>(id, id ? undefined : { method: 'POST' }));
  }

  async function renameSession(id: string, title: string) {
    const summary = await sessionRequest<WorkspaceSummary>(id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    });
    remember(summary);
  }

  async function reorderSessions(id: string, targetId: string, placement: 'before' | 'after') {
    const updated = await sessionRequest<WorkspaceSummary[]>(undefined, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, targetId, placement }),
    });
    setHistory((items) => {
      const byId = new Map(items.map((item) => [item.id, item]));
      const sorted = updated.map((item) => {
        const current = byId.get(item.id);
        byId.delete(item.id);
        return current && current.updatedAt > item.updatedAt ? current : item;
      });
      return [...byId.values(), ...sorted];
    });
  }

  async function removeSession(id: string, active: boolean) {
    const query = active ? new URLSearchParams({ selectNext: '1' }) : undefined;
    const result = await sessionRequest<RemovedWorkspace>(id, { method: 'DELETE' }, query);
    setHistory(result.sessions);
    if (result.nextSession) select(result.nextSession);
  }

  if (!session) return (
    <main className="grid h-dvh place-items-center bg-[#edf4f2] p-4">
      {initialError ? <div className="space-y-3 text-center">
        <p role="alert" className="text-sm text-red-700">{initialError}</p>
        <Button variant="outline" onClick={() => { setInitialError(''); setAttempt((count) => count + 1); }}>重新读取会话</Button>
      </div> : <p role="status" className="text-sm text-slate-600">正在打开工作区…</p>}
    </main>
  );

  return <Workspace key={session.id} session={session} settings={settings} setSettings={setSettings}
    extensions={extensions} setExtensions={setExtensions} skillLibrary={skillLibrary} setSkillLibrary={setSkillLibrary}
    openSession={openSession} history={history}
    remember={remember} renameSession={renameSession} reorderSessions={reorderSessions} removeSession={removeSession}
    isHistoryOpen={isHistoryOpen} setIsHistoryOpen={setIsHistoryOpen} isChatOpen={isChatOpen} setIsChatOpen={setIsChatOpen} />;
}

function Workspace({
  session, settings, setSettings, extensions, setExtensions, skillLibrary, setSkillLibrary, history, openSession, remember, renameSession, reorderSessions, removeSession,
  isHistoryOpen, setIsHistoryOpen, isChatOpen, setIsChatOpen,
}: {
  session: SavedWorkspace;
  settings: ModelSettings;
  setSettings: (value: ModelSettings) => void;
  extensions: Extensions;
  setExtensions: (value: Extensions) => void;
  skillLibrary: TextSkill[];
  setSkillLibrary: (skills: TextSkill[]) => void;
  openSession: (id?: string) => Promise<void>;
  history: WorkspaceSummary[];
  remember: (item: WorkspaceSummary) => void;
  renameSession: (id: string, title: string) => Promise<void>;
  reorderSessions: (id: string, targetId: string, placement: 'before' | 'after') => Promise<void>;
  removeSession: (id: string, active: boolean) => Promise<void>;
  isHistoryOpen: boolean;
  setIsHistoryOpen: (open: boolean) => void;
  isChatOpen: boolean;
  setIsChatOpen: (open: boolean) => void;
}) {
  const mindMapRef = useRef<MindMapViewHandle | null>(null);
  const frameRef = useRef<HTMLElement | null>(null);
  const editorPanelRef = useRef<HTMLDivElement | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const readEditor = useCallback(() => mindMapRef.current?.read(), []);
  const isEditorEditing = useCallback(() => mindMapRef.current?.isEditing() ?? false, []);
  const workspace = useCaseWorkspace(session, settings, extensions, readEditor, isEditorEditing);
  const {
    mindMap, messages: messageList, error, setError, warning, stats: mindMapStats,
    progress: loadingMessage, exporting: loadingExportXmind, exportCsv, exportXmind,
  } = workspace;
  const snapshot = useMemo(() => ({ messages: messageList, mindMap }), [mindMap, messageList]);
  const persistence = useSessionSave(session, snapshot, remember);
  const title = history.find(({ id }) => id === session.id)?.title ?? session.title;
  const [switching, setSwitching] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [scalePercent, setScalePercent] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const compact = useCompactWorkspace();
  const [view, selectView] = useState<WorkspaceView>(() => session.mindMap.children.length ? 'canvas' : 'chat');
  const chatVisible = compact ? view === 'chat' : isChatOpen;

  const loadingChat = workspace.mode !== null;
  const isInitialState = mindMap.children.length === 0;
  const canSend = !loadingChat && !switching && input.trim().length > 0;
  const hasCases = mindMapStats.caseCount > 0;

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === editorPanelRef.current);
      requestAnimationFrame(() => mindMapRef.current?.fit());
    };

    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    const feed = feedRef.current;
    if (chatVisible && feed && followLatestRef.current) feed.scrollTop = feed.scrollHeight;
  }, [chatVisible, loadingChat, messageList]);

  useEffect(() => {
    const frame = frameRef.current;
    const viewport = window.visualViewport;
    if (!compact || !frame || !viewport) return;
    function resize() {
      if (!frame || !viewport) return;
      if (viewport.scale <= 1.01 && viewport.height < window.innerHeight) {
        const inset = Math.max(0, frame.getBoundingClientRect().top - viewport.offsetTop);
        frame.style.setProperty('--workspace-height', Math.max(0, Math.floor(viewport.height - inset)) + 'px');
      } else {
        frame.style.removeProperty('--workspace-height');
      }
    }
    resize();
    viewport.addEventListener('resize', resize);
    return () => {
      viewport.removeEventListener('resize', resize);
      frame.style.removeProperty('--workspace-height');
    };
  }, [compact]);

  function fillSuggestion(content: string) {
    setInput(content);
    composerRef.current?.focus();
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (compact || event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void sendMessage();
  }

  async function toggleFullscreen() {
    const node = editorPanelRef.current;
    if (!node) return;

    try {
      if (document.fullscreenElement === node) {
        await document.exitFullscreen();
      } else {
        await node.requestFullscreen();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '全屏切换失败');
    }
  }

  async function switchSession(id?: string) {
    if (loadingChat || switching) return;
    setSwitching(true);
    try {
      const current = readEditor();
      const saved = await persistence.flush(current ? { ...snapshot, mindMap: normalizeMindMap(current) } : snapshot);
      if (saved) await openSession(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '切换会话失败');
    } finally {
      setSwitching(false);
    }
  }

  async function removeFromHistory(id: string) {
    const active = session.id === id;
    if (active && (loadingChat || switching)) return;
    if (active) setSwitching(true);
    try {
      await removeSession(id, active);
    } finally {
      if (active) setSwitching(false);
    }
  }

  function togglePanel(side: 'history' | 'chat', open: boolean) {
    if (side === 'history') setIsHistoryOpen(open);
    else {
      if (open) followLatestRef.current = true;
      setIsChatOpen(open);
    }
    requestAnimationFrame(() => document.getElementById((open ? 'collapse-' : 'expand-') + side)?.focus());
  }

  function changeView(next: WorkspaceView) {
    if (view === 'canvas' && next !== 'canvas') mindMapRef.current?.finishTextEdit();
    selectView(next);
  }

  function sendMessage() {
    if (!canSend) return;
    followLatestRef.current = true;
    void workspace.send(input.trim(), selection ?? undefined);
    setInput('');
  }

  const suggestions = !loadingChat && !input.trim() ? (
    <ChatSuggestions tree={mindMap} selection={selection} blank={isInitialState} followUps={messageList.at(-1)?.metadata?.followUps} choose={fillSuggestion} />
  ) : null;

  const extraActions = (
    <>
      <Button
        aria-label="撤销"
        className={compact ? "justify-start gap-1.5 px-2" : "h-9 w-9 p-0"}
        title="撤销"
        variant="outline"
        size="sm"
        disabled={workspace.mode === 'generate'}
        onClick={() => mindMapRef.current?.undo()}
      >
        <Undo2 className="h-4 w-4" />{compact && '撤销'}
      </Button>
      <Button
        aria-label="重做"
        className={compact ? "justify-start gap-1.5 px-2" : "h-9 w-9 p-0"}
        title="重做"
        variant="outline"
        size="sm"
        disabled={workspace.mode === 'generate'}
        onClick={() => mindMapRef.current?.redo()}
      >
        <Redo2 className="h-4 w-4" />{compact && '重做'}
      </Button>
      <Button
        aria-label="展开全部"
        className={compact ? "justify-start gap-1.5 px-2" : "h-9 w-9 p-0"}
        title="展开全部"
        variant="outline"
        size="sm"
        onClick={() => mindMapRef.current?.expandAll()}
      >
        <Expand className="h-4 w-4" />{compact && '展开全部'}
      </Button>
      <Button
        aria-label="折叠全部"
        className={compact ? "justify-start gap-1.5 px-2" : "h-9 w-9 p-0"}
        title="折叠全部"
        variant="outline"
        size="sm"
        onClick={() => mindMapRef.current?.collapseAll()}
      >
        <Shrink className="h-4 w-4" />{compact && '折叠全部'}
      </Button>
      <Button
        aria-label="刷新脑图"
        className={compact ? "justify-start gap-1.5 px-2" : "h-9 w-9 p-0"}
        title="刷新脑图"
        variant="outline"
        size="sm"
        onClick={() => mindMapRef.current?.refresh()}
      >
        <RefreshCw className="h-4 w-4" />{compact && '刷新脑图'}
      </Button>
      {!compact && <Button
        aria-label={isFullscreen ? '退出全屏' : '全屏'}
        className="h-9 w-9 p-0"
        title={isFullscreen ? '退出全屏' : '全屏'}
        variant="outline"
        size="sm"
        onClick={toggleFullscreen}
      >
        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </Button>}
      <Button variant="outline" size="sm" onClick={exportCsv} disabled={!hasCases}>
        <Download className="mr-2 h-4 w-4" />
        CSV
      </Button>
      <Button variant="outline" size="sm" onClick={exportXmind} disabled={!hasCases || loadingExportXmind}>
        {loadingExportXmind ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <FileArchive className="mr-2 h-4 w-4" />
        )}
        XMind
      </Button>
    </>
  );

  return (
    <main ref={frameRef} className={'workspace-frame overflow-hidden bg-[#edf4f2]' + (compact ? ' workspace-compact' : '')}>
      <Card ref={editorPanelRef} className="relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border-[#dce8e7] bg-white shadow-sm">
        <CardHeader className="gap-2 border-b border-[#e7eeec] px-2.5 py-2 sm:px-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <CardTitle className="mr-auto flex min-w-0 items-center gap-1.5 text-sm font-semibold tracking-tight text-[#183637] lg:gap-2.5 lg:text-base">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#e4f3ee] text-[#14685f] lg:h-8 lg:w-8">
                <Workflow aria-hidden="true" className="h-4 w-4" />
              </span>
              测试用例脑图
              {standalone && <span className="shrink-0 text-[11px] font-normal text-slate-600">单文件版</span>}
            </CardTitle>
            <ModelSettingsDialog settings={settings} onChange={setSettings} />
            {compact && <div className="w-full sm:w-auto sm:min-w-64"><WorkspaceViews view={view} select={changeView} /></div>}
            {(!compact || view === 'canvas') && (
              <div className="flex w-full min-w-0 items-center gap-1 lg:w-auto lg:flex-wrap lg:gap-1.5">
                <Button
                  aria-label="缩小"
                  className="h-9 w-9 p-0"
                  title="缩小"
                  variant="outline"
                  size="sm"
                  onClick={() => mindMapRef.current?.zoomOut()}
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="w-12 text-center text-xs text-slate-600">{scalePercent}%</span>
                <Button
                  aria-label="放大"
                  className="h-9 w-9 p-0"
                  title="放大"
                  variant="outline"
                  size="sm"
                  onClick={() => mindMapRef.current?.zoomIn()}
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button
                  aria-label="适应画布"
                  className="h-9 w-9 p-0"
                  title="适应画布"
                  variant="outline"
                  size="sm"
                  onClick={() => mindMapRef.current?.fit()}
                >
                  <Scan className="h-4 w-4" />
                </Button>
                {compact && (
                  <details className="relative ml-auto" onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector('summary')?.focus();
                  }}>
                    <summary aria-label="更多脑图操作" title="更多脑图操作"
                      className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-md border border-input bg-white hover:bg-muted">
                      <Ellipsis aria-hidden="true" className="h-4 w-4" />
                    </summary>
                    <div onClick={(event) => {
                      if (!(event.target instanceof Element) || !event.target.closest('button:not(:disabled)')) return;
                      const menu = event.currentTarget.closest('details');
                      if (menu) {
                        menu.open = false;
                        menu.querySelector('summary')?.focus();
                      }
                    }} className="absolute right-0 z-40 mt-2 grid max-h-[min(16rem,45dvh)] w-56 grid-cols-2 gap-1 overflow-y-auto rounded-xl border border-[#dce8e7] bg-white p-2 shadow-lg">
                      {extraActions}
                    </div>
                  </details>
                )}
                {!compact && extraActions}
                <NodeSearch tree={mindMap} onSelect={(id) => mindMapRef.current?.locate(id)} />
              </div>
            )}
          </div>
          {!compact && hasCases ? (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
              {(['P0', 'P1', 'P2', 'P3'] as const).map((priority) => (
                <span key={priority} className="rounded-md border bg-slate-50 px-2 py-1">
                  {priority}: {mindMapStats.priorities[priority]}
                </span>
              ))}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="mt-0 min-h-0 min-w-0 flex-1 p-2 lg:p-3">
          <WorkspacePanels
            compact={compact} view={view}
            expandHistory={() => togglePanel('history', true)}
            expandChat={() => togglePanel('chat', true)}
            history={compact || isHistoryOpen ? <SessionHistory items={history} selected={session.id} disabled={loadingChat || switching}
              select={(id) => { void switchSession(id); }} rename={renameSession} reorder={reorderSessions} remove={removeFromHistory}
              collapse={compact ? undefined : () => togglePanel('history', false)} /> : undefined}
            canvas={<section aria-label="脑图编辑区" className="h-full min-h-0 min-w-0">
              <MindMapView
                ref={mindMapRef}
                data={mindMap}
                compact={compact}
                onChange={workspace.commitMap}
                readOnly={workspace.mode === 'generate' || switching}
                onScaleChange={setScalePercent}
                onSelectionChange={setSelection}
              />
            </section>}
            chat={compact || isChatOpen ? (
              <aside aria-label="AI 对话区" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[#d6e6e2] bg-white">
                <div className="flex items-center justify-between gap-3 border-b border-[#e1ebe8] bg-[#f3f8f6] px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-slate-700" />
                    <span className="truncate text-sm font-semibold text-[#183637]" title={title}>{title}</span>
                    <span className="shrink-0 rounded-md border bg-white px-2 py-0.5 text-xs text-slate-500">
                      {loadingChat ? '处理中' : hasCases ? '可编辑' : '待生成'}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button type="button" variant="outline" size="sm" disabled={loadingChat || switching}
                      className="h-8 gap-1.5 px-2" onClick={() => { void switchSession(); }}>
                      <Plus aria-hidden="true" className="h-4 w-4" />新建会话
                    </Button>
                    {!compact && <button id="collapse-chat" type="button" aria-label="折叠对话" title="折叠对话" onClick={() => togglePanel('chat', false)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border bg-white text-slate-600 hover:bg-muted">
                      <PanelRightClose aria-hidden="true" className="h-4 w-4" />
                    </button>}
                  </div>
                </div>

                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <div ref={feedRef} onScroll={(event) => {
                    const feed = event.currentTarget;
                    followLatestRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 56;
                  }} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-[#f7faf9] px-3 py-3">
                    <div className="flex flex-col gap-2.5">
                      {messageList.length === 0 ? (
                        <div className="rounded-lg border border-dashed bg-white p-3 text-sm leading-6 text-slate-500">
                          {standalone ? '粘贴需求正文或业务规则，生成第一版测试用例。' : '输入需求正文、业务规则或资料链接，生成第一版测试用例。'}
                        </div>
                      ) : (
                        messageList.map((message) => (
                          <ConversationEntry key={message.id} message={message} running={loadingChat && message === messageList.at(-1)} />
                        ))
                      )}
                      {loadingChat && messageList.at(-1)?.role !== 'assistant' ? (
                        <div role="status" className="text-xs text-[#456469]">
                          <Loader2 aria-hidden="true" className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                          {loadingMessage || '正在处理…'}
                        </div>
                      ) : null}
                      {compact && suggestions}
                    </div>
                  </div>

                  <div className="workspace-composer min-w-0 border-t border-[#e2ece9] bg-white p-2.5 lg:p-3">
                    {!compact && suggestions}
                    <Textarea
                      ref={composerRef}
                      aria-label={isInitialState ? "需求正文" : "修改指令"}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleInputKeyDown}
                      className="min-h-16 resize-none rounded-xl bg-[#fafcfb] text-base lg:min-h-[74px] lg:text-sm"
                      placeholder={
                        isInitialState
                          ? compact ? '输入需求内容' : '输入需求内容，按 Enter 发送；Shift+Enter 换行'
                          : '输入修改指令，例如：删除某分支，新增 3 条边界用例'
                      }
                    />
                    {persistence.status === 'error' ? (
                      <div className="mt-2 flex items-center gap-2">
                        <p role="alert" className="text-xs text-red-700">{persistence.error}</p>
                        <Button type="button" variant="outline" size="sm" onClick={() => { void persistence.flush(); }}>重试保存</Button>
                      </div>
                    ) : <p role="status" className="mt-2 text-[11px] text-slate-500">
                      {persistence.status === 'saving' ? '正在保存会话…' : '会话已保存'}
                    </p>}
                    {warning && <p role="status" className="mt-2 text-xs text-amber-800">{warning}</p>}
                    {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
                    {!loadingChat && workspace.retry && (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                        {workspace.retry.errors.map((message) => <p key={message}>{message}</p>)}
                        <Button variant="outline" size="sm" className="mt-1" onClick={workspace.retryFailed}>
                          重试 {workspace.retry.retry.plan.failedIds.length} 个失败或未完成模块
                        </Button>
                      </div>
                    )}
                    <div className="workspace-chat-actions mt-2 flex flex-wrap items-center justify-end gap-2">
                      <WorkspaceExtensions value={extensions} onChange={setExtensions} library={skillLibrary} onLibraryChange={setSkillLibrary}
                          disabled={loadingChat || switching} />
                      {loadingChat && (
                        <Button variant="outline" size="sm" onClick={workspace.cancel}>{workspace.mode === 'generate' ? '停止生成' : '停止修改'}</Button>
                      )}
                      <Button className="h-9 shrink-0" onClick={sendMessage} disabled={!canSend}>
                        {loadingChat ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="mr-2 h-4 w-4" />
                        )}
                        发送
                      </Button>
                    </div>
                  </div>
                </div>
              </aside>
            ) : undefined}
          />
        </CardContent>
      </Card>
    </main>
  );
}
