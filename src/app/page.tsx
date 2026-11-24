'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  Download,
  Expand,
  FileArchive,
  Loader2,
  Maximize2,
  MessageSquare,
  Workflow,
  Minimize2,
  Redo2,
  RefreshCw,
  Scan,
  Send,
  Shrink,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { NodeSearch } from '@/components/mindmap/node-search';
import { MindMapView, type MindMapViewHandle } from '@/components/mindmap/mindmap-view';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ConversationEntry } from '@/components/workspace/conversation-entry';
import { ChatSuggestions } from '@/components/workspace/chat-support';
import { ModelSettingsDialog } from '@/components/workspace/model-settings';
import { WorkspaceExtensions } from '@/components/workspace/workspace-extensions';
import { useCaseWorkspace } from '@/components/workspace/use-case-workspace';

export default function Page() {
  const mindMapRef = useRef<MindMapViewHandle | null>(null);
  const editorPanelRef = useRef<HTMLDivElement | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const readEditor = useCallback(() => mindMapRef.current?.read(), []);
  const isEditorEditing = useCallback(() => mindMapRef.current?.isEditing() ?? false, []);
  const workspace = useCaseWorkspace(readEditor, isEditorEditing);
  const {
    mindMap, messages: messageList, error, setError, warning, stats: mindMapStats,
    progress: loadingMessage, exporting: loadingExportXmind, exportCsv, exportXmind,
  } = workspace;
  const [selection, setSelection] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [scalePercent, setScalePercent] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);

  const loadingChat = workspace.mode !== null;
  const isInitialState = mindMap.children.length === 0;
  const canSend = !loadingChat && input.trim().length > 0;
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
    if (feed && followLatestRef.current) feed.scrollTop = feed.scrollHeight;
  }, [isChatOpen, loadingChat, messageList]);

  function fillSuggestion(content: string) {
    setInput(content);
    composerRef.current?.focus();
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
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

  function sendMessage() {
    if (!canSend) return;
    followLatestRef.current = true;
    void workspace.send(input.trim());
    setInput('');
  }

  return (
    <main className="h-dvh overflow-hidden bg-[#edf4f2] p-2 sm:p-3">
      <Card ref={editorPanelRef} className="relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border-[#dce8e7] bg-white shadow-sm">
        <CardHeader className="border-b border-[#e7eeec] px-3 py-2.5 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-[#183637]"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e4f3ee] text-[#14685f]"><Workflow aria-hidden="true" className="h-4 w-4" /></span>测试用例脑图</CardTitle>
              <CardDescription className="mt-1.5 text-xs text-[#456469]">
                {mindMapStats.caseCount > 0
                  ? `${mindMapStats.categories} 个类别，${mindMapStats.preconditions} 组前置条件，${mindMapStats.caseCount} 条用例`
                  : '输入需求后生成第一版脑图'}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                aria-label="撤销"
                className="h-9 w-9 p-0"
                title="撤销"
                variant="outline"
                size="sm"
                disabled={workspace.mode === 'generate'}
                onClick={() => mindMapRef.current?.undo()}
              >
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button
                aria-label="重做"
                className="h-9 w-9 p-0"
                title="重做"
                variant="outline"
                size="sm"
                disabled={workspace.mode === 'generate'}
                onClick={() => mindMapRef.current?.redo()}
              >
                <Redo2 className="h-4 w-4" />
              </Button>
              <span className="mx-1 h-5 w-px bg-slate-200" />
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
              <Button
                aria-label="展开全部"
                className="h-9 w-9 p-0"
                title="展开全部"
                variant="outline"
                size="sm"
                onClick={() => mindMapRef.current?.expandAll()}
              >
                <Expand className="h-4 w-4" />
              </Button>
              <Button
                aria-label="折叠全部"
                className="h-9 w-9 p-0"
                title="折叠全部"
                variant="outline"
                size="sm"
                onClick={() => mindMapRef.current?.collapseAll()}
              >
                <Shrink className="h-4 w-4" />
              </Button>
              <Button
                aria-label="刷新脑图"
                className="h-9 w-9 p-0"
                title="刷新脑图"
                variant="outline"
                size="sm"
                onClick={() => mindMapRef.current?.refresh()}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                aria-label={isFullscreen ? '退出全屏' : '全屏'}
                className="h-9 w-9 p-0"
                title={isFullscreen ? '退出全屏' : '全屏'}
                variant="outline"
                size="sm"
                onClick={toggleFullscreen}
              >
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
              <span className="mx-1 h-5 w-px bg-slate-200" />
              <NodeSearch tree={mindMap} onSelect={(id) => mindMapRef.current?.locate(id)} />
              {!isChatOpen ? (
                <Button variant="outline" size="sm" onClick={() => { followLatestRef.current = true; setIsChatOpen(true); }} aria-label="展开 AI 对话">
                  <MessageSquare aria-hidden="true" className="mr-1.5 h-4 w-4" /> 对话
                </Button>
              ) : null}
              <ModelSettingsDialog settings={workspace.settings} onChange={workspace.setSettings} />
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
            </div>
          </div>
          {hasCases ? (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
              {(['P0', 'P1', 'P2', 'P3'] as const).map((priority) => (
                <span key={priority} className="rounded-md border bg-slate-50 px-2 py-1">
                  {priority}: {mindMapStats.priorities[priority]}
                </span>
              ))}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="workspace-body mt-0 grid min-h-0 min-w-0 flex-1 gap-3 p-3" data-chat-open={isChatOpen}>
          <section aria-label="脑图编辑区" className="min-h-0 min-w-0">
            <MindMapView
              ref={mindMapRef}
              data={mindMap}
              onChange={workspace.commitMap}
              readOnly={workspace.mode === 'generate'}
              onScaleChange={setScalePercent}
              onSelectionChange={setSelection}
            />
          </section>
          {isChatOpen ? (
            <aside aria-label="AI 对话区" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[#d6e6e2] bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-[#e1ebe8] bg-[#f3f8f6] px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-slate-700" />
                  <span className="truncate text-sm font-semibold text-[#183637]">AI 对话</span>
                  <span className="shrink-0 rounded-md border bg-white px-2 py-0.5 text-xs text-slate-500">
                    {loadingChat ? '处理中' : hasCases ? '可编辑' : '待生成'}
                  </span>
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-white text-slate-500 hover:bg-slate-100"
                  title="收起对话"
                  aria-label="收起对话"
                  onClick={() => setIsChatOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div ref={feedRef} onScroll={(event) => {
                  const feed = event.currentTarget;
                  followLatestRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 56;
                }} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#f7faf9] px-3 py-3">
                  <div className="flex flex-col gap-2.5">
                    {messageList.length === 0 ? (
                      <div className="rounded-lg border border-dashed bg-white p-3 text-sm leading-6 text-slate-500">
                        输入需求正文、业务规则或资料链接，生成第一版测试用例。
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
                  </div>
                </div>

                <div className="min-w-0 border-t border-[#e2ece9] bg-white p-3">
                  {!loadingChat && !input.trim() ? <ChatSuggestions tree={mindMap} selection={selection} blank={isInitialState} choose={fillSuggestion} /> : null}
                  <Textarea
                    ref={composerRef}
                    aria-label={isInitialState ? "需求正文" : "修改指令"}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    className="min-h-[74px] resize-none rounded-xl bg-[#fafcfb] text-sm"
                    placeholder={
                      isInitialState
                        ? '输入需求内容，按 Enter 发送；Shift+Enter 换行'
                        : '输入修改指令，例如：删除某分支，新增 3 条边界用例'
                    }
                  />
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
                  <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                    <WorkspaceExtensions value={workspace.extensions} onChange={workspace.setExtensions} disabled={loadingChat} />
                    {workspace.mode === 'generate' && (
                      <Button variant="outline" size="sm" onClick={workspace.cancel}>停止生成</Button>
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
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
