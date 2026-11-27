'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, GitBranch, Loader2, MessageSquare, PanelRightClose, Plus, Send, Workflow } from 'lucide-react';
import { CanvasControls, CanvasExport } from '@/components/workspace/canvas-controls';
import { CanvasStart } from '@/components/workspace/canvas-start';
import { MindMapView, type MindMapViewHandle } from '@/components/mindmap/mindmap-view';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ConversationEntry } from '@/components/workspace/conversation-entry';
import { ChatSuggestions } from '@/components/workspace/chat-support';
import { ModelSettingsDialog, readSavedSettings } from '@/components/workspace/model-settings';
import { WorkspaceExtensions } from '@/components/workspace/workspace-extensions';
import { useCaseWorkspace } from '@/components/workspace/use-case-workspace';
import { rememberGeneration } from '@/components/workspace/generation-retry';
import { SessionHistory } from '@/components/workspace/session-history';
import { WorkspacePanels, WorkspaceViews, useCompactWorkspace, type WorkspaceView } from '@/components/workspace/workspace-panels';
import { SessionRequestError, sessionRequest } from '@/components/workspace/session-client';
import { deletedWorkspaceDraft, recoverWorkspaceDraft, writeWorkspaceDraft } from '@/components/workspace/workspace-draft';
import { download } from '@/lib/client/download';
import { useSessionSave } from '@/components/workspace/use-session-save';
import { standalone } from '@/lib/client/runtime';
import { normalizeMindMap } from '@/lib/agent/mindMap';
import { maxRequirementLength } from '@/lib/agent/contracts';
import type { Extensions, TextSkill } from '@/lib/agent/extensionContracts';
import type { ModelSettings } from '@/lib/agent/modelConfig';
import type { RemovedWorkspace, SavedWorkspace, WorkspaceSnapshot, WorkspaceSummary, WorkspaceWrite } from '@/lib/workspaces/types';

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
        const orphan = deletedWorkspaceDraft(lastId, list);
        if (orphan) {
          if (!controller.signal.aborted) { setHistory(list); setSession(orphan); }
          return;
        }
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

  async function leaveDeletedSession(id: string, copy?: WorkspaceWrite) {
    const list = await sessionRequest<WorkspaceSummary[]>();
    const nextId = !copy && list[0]?.id;
    const next = nextId ? await sessionRequest<SavedWorkspace>(nextId)
      : await sessionRequest<SavedWorkspace>(undefined, {
        method: 'POST', ...(copy && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 0, ...copy }) }),
      });
    setHistory(list);
    select(next);
    writeWorkspaceDraft(id);
    rememberGeneration(id);
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
    writeWorkspaceDraft(id);
    rememberGeneration(id);
    setHistory(result.sessions);
    if (result.nextSession) select(result.nextSession);
  }

  if (!session) return (
    <main className="grid h-dvh place-items-center bg-[#f3f3f8] p-4">
      {initialError ? <div className="space-y-3 text-center">
        <p role="alert" className="text-sm text-red-700">{initialError}</p>
        <Button variant="outline" onClick={() => { setInitialError(''); setAttempt((count) => count + 1); }}>重新读取会话</Button>
      </div> : <p role="status" className="text-sm text-slate-600">正在打开工作区…</p>}
    </main>
  );

  return <Workspace key={session.id} session={session} settings={settings} setSettings={setSettings}
    extensions={extensions} setExtensions={setExtensions} skillLibrary={skillLibrary} setSkillLibrary={setSkillLibrary}
    openSession={openSession} leaveDeletedSession={leaveDeletedSession} history={history}
    remember={remember} renameSession={renameSession} reorderSessions={reorderSessions} removeSession={removeSession}
    isHistoryOpen={isHistoryOpen} setIsHistoryOpen={setIsHistoryOpen} isChatOpen={isChatOpen} setIsChatOpen={setIsChatOpen} />;
}

function Workspace({
  session, settings, setSettings, extensions, setExtensions, skillLibrary, setSkillLibrary, history, openSession, remember, renameSession, reorderSessions, removeSession,
  leaveDeletedSession, isHistoryOpen, setIsHistoryOpen, isChatOpen, setIsChatOpen,
}: {
  session: SavedWorkspace;
  settings: ModelSettings;
  setSettings: (value: ModelSettings) => void;
  extensions: Extensions;
  setExtensions: (value: Extensions) => void;
  skillLibrary: TextSkill[];
  setSkillLibrary: (skills: TextSkill[]) => void;
  openSession: (id?: string) => Promise<void>;
  leaveDeletedSession: (id: string, copy?: WorkspaceWrite) => Promise<void>;
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
  const [draft] = useState(() => recoverWorkspaceDraft(session));
  const [protectDraft, setProtectDraft] = useState(Boolean(draft.conflict));
  const workspace = useCaseWorkspace({ ...session, ...draft.recovered?.snapshot }, settings, extensions, readEditor, isEditorEditing);
  const {
    mindMap, messages: messageList, error, setError, warning, stats: mindMapStats,
    progress: loadingMessage, exporting: loadingExportXmind, exportCsv, exportXmind,
  } = workspace;
  const snapshot = useMemo(() => ({ messages: messageList, mindMap }), [mindMap, messageList]);
  const finishActiveEdit = useCallback(() => {
    const editor = mindMapRef.current;
    if (!editor?.isEditing()) return;
    editor.finishTextEdit();
    return editor.read();
  }, []);
  const commitMap = workspace.commitMap;
  const commitActiveEdit = useCallback(() => {
    const tree = finishActiveEdit();
    if (tree) commitMap(tree);
  }, [finishActiveEdit, commitMap]);
  const capture = useCallback((latest: WorkspaceSnapshot) => {
    const tree = finishActiveEdit();
    return tree ? { ...latest, mindMap: normalizeMindMap(tree) } : undefined;
  }, [finishActiveEdit]);
  const persistence = useSessionSave(session, snapshot, remember, {
    initialWriteIds: draft.recovered?.version === session.version ? draft.recovered.writeIds : undefined,
    initiallyDeleted: !history.some(({ id }) => id === session.id),
    protectDraft,
    capture,
  });
  const title = history.find(({ id }) => id === session.id)?.title ?? session.title;
  const [switching, setSwitching] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [manualCanvas, setManualCanvas] = useState(false);
  const [scalePercent, setScalePercent] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const compact = useCompactWorkspace(commitActiveEdit);
  const [view, selectView] = useState<WorkspaceView>(() => !session.mindMap.children.length && session.messages.length ? 'chat' : 'canvas');
  const chatVisible = compact ? view === 'chat' : isChatOpen;

  const loadingChat = workspace.mode !== null;
  const isInitialState = mindMap.children.length === 0;
  const inputLength = input.trim().length;
  const excessLength = inputLength - maxRequirementLength;
  const canSend = !loadingChat && !switching && inputLength > 0 && excessLength <= 0;
  const hasCases = mindMapStats.caseCount > 0;

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === editorPanelRef.current);
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
      const current = finishActiveEdit() ?? readEditor();
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

  async function finishDeletedDraft(saveCopy: boolean) {
    if (loadingChat || switching || (!saveCopy && !window.confirm('放弃本页草稿并打开其他会话？'))) return;
    const current = capture(snapshot) ?? snapshot;
    setSwitching(true);
    try {
      await leaveDeletedSession(session.id, saveCopy ? { ...current, writeId: persistence.copyWriteId() } : undefined);
    } catch (cause) {
      if (saveCopy && cause instanceof SessionRequestError && cause.status === 409) persistence.copyWriteId(true);
      setError(cause instanceof Error ? cause.message : '无法打开会话，本页草稿仍保留');
    } finally {
      setSwitching(false);
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
    if (view === 'canvas' && next !== 'canvas') commitActiveEdit();
    selectView(next);
  }

  function sendMessage() {
    if (!canSend) return;
    followLatestRef.current = true;
    if (workspace.send(input.trim(), selection ?? undefined)) setInput('');
  }

  const suggestions = !loadingChat && !input.trim() ? (
    <ChatSuggestions tree={mindMap} selection={selection} blank={isInitialState} followUps={messageList.at(-1)?.metadata?.followUps} choose={fillSuggestion} />
  ) : null;

  const showStart = isInitialState && !manualCanvas && !messageList.length && !loadingChat;
  function compose(example?: string) {
    if (example) setInput(example);
    if (compact) selectView('chat');
    else setIsChatOpen(true);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  return (
    <main ref={frameRef} className={'workspace-frame' + (compact ? ' workspace-compact' : '')}>
      <div ref={editorPanelRef} className="workspace-shell">
        <header className="workbench-masthead">
          <div className="workbench-identity">
            <span className="workbench-mark"><Workflow size={21} strokeWidth={1.8} aria-hidden="true" /></span>
            <h1>测试用例工作台</h1>
            {standalone && <span className="edition">单文件版</span>}
          </div>
          <div className="masthead-actions">
            <ModelSettingsDialog settings={settings} onChange={setSettings} />
            <button type="button" className="new-session" aria-label="新建会话" title="新建会话"
              disabled={loadingChat || switching} onClick={() => { void switchSession(); }}>
              <Plus size={16} aria-hidden="true" /><span>新建会话</span>
            </button>
          </div>
        </header>
        {compact && <WorkspaceViews view={view} select={changeView} />}
        {persistence.deleted && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p role="alert">原会话已删除，本页改动保留为草稿。</p>
            <Button type="button" variant="outline" size="sm" disabled={loadingChat || switching} onClick={() => void finishDeletedDraft(true)}>另存为新会话</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => {
              download(new Blob([JSON.stringify(capture(snapshot) ?? snapshot, null, 2)], { type: 'application/json' }), 'workspace-draft.json');
            }}>下载当前草稿</Button>
            <Button type="button" variant="outline" size="sm" disabled={loadingChat || switching} onClick={() => void finishDeletedDraft(false)}>放弃并离开</Button>
          </div>
        )}
        {protectDraft && draft.conflict && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p role="alert">会话已在其他标签页更新，本页保留了未合并的草稿。</p>
            <Button type="button" variant="outline" size="sm" onClick={() => {
              download(new Blob([JSON.stringify(draft.conflict?.snapshot, null, 2)], { type: 'application/json' }), 'workspace-draft.json');
            }}>下载本页草稿</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => {
              if (window.confirm('放弃本页未合并的草稿？')) {
                writeWorkspaceDraft(session.id);
                setProtectDraft(false);
              }
            }}>放弃本页草稿</Button>
          </div>
        )}
        <div className="workspace-body">
          <WorkspacePanels
            compact={compact} view={view}
            expandHistory={() => togglePanel('history', true)}
            expandChat={() => togglePanel('chat', true)}
            history={compact || isHistoryOpen ? <SessionHistory items={history} selected={session.id} disabled={loadingChat || switching}
              select={(id) => { void switchSession(id); }} rename={renameSession} reorder={reorderSessions} remove={removeFromHistory}
              collapse={compact ? undefined : () => togglePanel('history', false)} /> : undefined}
            canvas={<section aria-label="脑图编辑区" className="canvas-pane">
              <div className="canvas-heading">
                <div className="canvas-title"><GitBranch size={17} aria-hidden="true" /><h2 title={title}>{hasCases ? title : '用例脑图'}</h2></div>
                {hasCases && <CanvasExport busy={loadingExportXmind} csv={exportCsv} xmind={exportXmind} />}
              </div>
              {showStart ? <CanvasStart compose={compose} edit={() => setManualCanvas(true)} /> : <>
                <div className="canvas-surface">
                  <MindMapView ref={mindMapRef} data={mindMap} compact={compact} onChange={workspace.commitMap}
                    readOnly={workspace.mode === 'generate' || switching} onScaleChange={setScalePercent} onSelectionChange={setSelection} />
                </div>
                <div className="canvas-footer">
                  <div className="case-metrics" aria-label="用例统计">
                    <span><strong>{mindMapStats.caseCount}</strong> 条用例</span>
                    {(['P0', 'P1', 'P2', 'P3'] as const).filter((p) => mindMapStats.priorities[p]).map((p) =>
                      <span className={'priority-count priority-' + p} key={p}>{p} <b>{mindMapStats.priorities[p]}</b></span>)}
                  </div>
                  <CanvasControls editor={mindMapRef} tree={mindMap} scale={scalePercent} readOnly={workspace.mode === 'generate' || switching}
                    fullscreen={isFullscreen} toggleFullscreen={toggleFullscreen} />
                </div>
              </>}
            </section>}
            chat={compact || isChatOpen ? (
              <aside aria-label="AI 对话区" className="workspace-chat">
                <header className="chat-heading">
                  <div className="chat-heading-label"><MessageSquare size={17} aria-hidden="true" /><h2>AI 对话</h2></div>
                  {loadingChat && <span className="chat-busy">处理中</span>}
                  {!compact && <button id="collapse-chat" type="button" aria-label="折叠对话" title="折叠对话" onClick={() => togglePanel('chat', false)}>
                    <PanelRightClose aria-hidden="true" size={16} />
                  </button>}
                </header>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <div ref={feedRef} onScroll={(event) => {
                    const feed = event.currentTarget;
                    followLatestRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 56;
                  }} className="chat-feed min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
                    <div className="flex flex-col gap-5">
                      {messageList.length === 0 ? (
                        <div className="chat-welcome">
                          <span className="chat-welcome-icon"><MessageSquare size={19} aria-hidden="true" /></span>
                          <h3>描述你要验证的需求</h3>
                          <p>{standalone ? '粘贴业务规则，或从需求示例开始。' : '粘贴业务规则或文档链接，也可以从需求示例开始。'}</p>
                        </div>
                      ) : (
                        messageList.map((message) => (
                          <ConversationEntry key={message.id} message={message} running={loadingChat && message === messageList.at(-1)} />
                        ))
                      )}
                      {loadingChat && messageList.at(-1)?.role !== 'assistant' ? (
                        <div role="status" className="text-xs text-[#666980]">
                          <Loader2 aria-hidden="true" className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                          {loadingMessage || '正在处理…'}
                        </div>
                      ) : null}
                      {compact && suggestions}
                    </div>
                  </div>

                  <div className="workspace-composer min-w-0">
                    {!compact && suggestions}
                    <Textarea
                      ref={composerRef}
                      aria-label={isInitialState ? "需求正文" : "修改指令"}
                      value={input}
                      aria-invalid={excessLength > 0}
                      aria-describedby={excessLength > 0 ? 'message-length-error' : undefined}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleInputKeyDown}
                      className="composer-input min-h-20 resize-none rounded-lg text-base lg:text-sm"
                      placeholder={
                        isInitialState
                          ? compact ? '输入需求内容' : '输入需求，Enter 发送，Shift+Enter 换行'
                          : '输入修改指令，例如：删除某分支，新增 3 条边界用例'
                      }
                    />
                    {excessLength > 0 && (
                      <p id="message-length-error" role="status" className="mt-2 text-xs text-red-700">
                        每条消息最多 {maxRequirementLength.toLocaleString('zh-CN')} 个字符，当前超出 {excessLength} 个。请缩短后发送。
                      </p>
                    )}
                    {persistence.deleted ? <p role="status" className="mt-2 text-[11px] text-amber-800">原会话已删除，请另存本页草稿。</p> : persistence.status === 'error' ? (
                      <div className="mt-2 flex items-center gap-2">
                        <p role="alert" className="text-xs text-red-700">{persistence.error}</p>
                        <Button type="button" variant="outline" size="sm" onClick={() => { void persistence.flush(); }}>重试保存</Button>
                      </div>
                    ) : <p role="status" className="save-status"><Check size={12} aria-hidden="true" />
                      {persistence.status === 'saving' ? '正在保存会话…' : '会话已保存'}
                    </p>}
                    {warning && <p role="status" className="mt-2 text-xs text-amber-800">{warning}</p>}
                    {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
                    {!loadingChat && workspace.retry && (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                        {workspace.retry.errors.map((message) => <p key={message}>{message}</p>)}
                        <Button variant="outline" size="sm" className="mt-1" onClick={workspace.retryFailed} disabled={switching}>
                          {workspace.retry.retry.plan ? '重试 ' + workspace.retry.retry.plan.failedIds.length + ' 个失败或未完成模块' : '用原需求重试'}
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
        </div>
      </div>
    </main>
  );
}
