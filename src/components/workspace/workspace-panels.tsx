'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { History, MessageSquare, PanelLeftOpen, PanelRightOpen, Workflow } from 'lucide-react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';

const compactMedia = '(width < 1024px)';

export type WorkspaceView = 'canvas' | 'chat' | 'history';

const views = [
  { id: 'canvas', label: '脑图', Icon: Workflow },
  { id: 'chat', label: 'AI 对话', Icon: MessageSquare },
  { id: 'history', label: '历史', Icon: History },
] as const;

function subscribe(listener: () => void) {
  const media = window.matchMedia(compactMedia);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}

export function useCompactWorkspace() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(compactMedia).matches, () => false);
}

export function WorkspaceViews({ view, select }: { view: WorkspaceView; select: (view: WorkspaceView) => void }) {
  return (
    <nav aria-label="工作区视图" className="grid grid-cols-3 gap-1 rounded-xl bg-[#eef5f2] p-1">
      {views.map(({ id, label, Icon }) => (
        <button key={id} type="button" aria-pressed={view === id} aria-controls={'mobile-' + id}
          className="flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg px-1 text-sm font-medium text-slate-600 aria-pressed:bg-white aria-pressed:text-primary aria-pressed:shadow-sm"
          onClick={() => select(id)}>
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{label}
        </button>
      ))}
    </nav>
  );
}

function CollapsedRail({ side, expand }: { side: 'history' | 'chat'; expand: () => void }) {
  const isHistory = side === 'history';
  const title = isHistory ? '历史对话' : '对话';
  const OpenIcon = isHistory ? PanelLeftOpen : PanelRightOpen;
  return (
    <aside aria-label={title + '已折叠'}
      className="flex h-full w-10 shrink-0 flex-col items-center gap-3 rounded-xl border border-[#d6e6e2] bg-[#f3f8f6] pt-2 text-slate-600">
      <button id={'expand-' + side} type="button" aria-label={'展开' + title} title={'展开' + title} onClick={expand}
        className="grid h-7 w-7 place-items-center rounded-md border border-[#d6e6e2] bg-white hover:bg-[#e5f1ee]">
        <OpenIcon aria-hidden="true" className="h-4 w-4" />
      </button>
      <span className="[writing-mode:vertical-rl] text-xs font-medium tracking-widest">{title}</span>
    </aside>
  );
}

type PanelContent = { history?: ReactNode; canvas: ReactNode; chat?: ReactNode };

export function WorkspacePanels({ compact, view, ...props }: PanelContent & {
  compact: boolean;
  view: WorkspaceView;
  expandHistory: () => void;
  expandChat: () => void;
}) {
  if (!compact) return <DesktopWorkspacePanels {...props} />;
  return (
    <div className="relative h-full min-h-0 min-w-0">
      {views.map(({ id }) => (
        <div key={id} id={'mobile-' + id} inert={view !== id}
          className={view === id ? 'absolute inset-0' : 'invisible absolute inset-0'}>
          {props[id]}
        </div>
      ))}
    </div>
  );
}

function DesktopWorkspacePanels({ history, canvas, chat, expandHistory, expandChat }: PanelContent & {
  expandHistory: () => void;
  expandChat: () => void;
}) {
  const panelIds = [...(history ? ['history-pane'] : []), 'canvas-pane', ...(chat ? ['chat-pane'] : [])];
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'workspace-widths',
    panelIds,
    onlySaveAfterUserInteractions: true,
  });
  return (
    <div className="flex h-full min-h-0 min-w-0 gap-2">
      {history ? null : <CollapsedRail side="history" expand={expandHistory} />}
      <Group id="workspace-panels" className="min-h-0 min-w-0 flex-1" orientation="horizontal"
        defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
        {history ? (
          <>
            <Panel id="history-pane" defaultSize="18%" minSize="155px">{history}</Panel>
            <Separator id="history-splitter" aria-label="调整历史栏宽度" className="panel-separator" />
          </>
        ) : null}
        <Panel id="canvas-pane" minSize="240px">{canvas}</Panel>
        {chat ? (
          <>
            <Separator id="chat-splitter" aria-label="调整对话栏宽度" className="panel-separator" />
            <Panel id="chat-pane" defaultSize="29%" minSize="260px">{chat}</Panel>
          </>
        ) : null}
      </Group>
      {chat ? null : <CollapsedRail side="chat" expand={expandChat} />}
    </div>
  );
}
