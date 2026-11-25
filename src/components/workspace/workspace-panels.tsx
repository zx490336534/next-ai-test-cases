'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';

const desktop = '(min-width: 740px)';

function subscribe(listener: () => void) {
  const media = window.matchMedia(desktop);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
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

export function WorkspacePanels({ history, canvas, chat, expandHistory, expandChat }: {
  history?: ReactNode;
  canvas: ReactNode;
  chat?: ReactNode;
  expandHistory: () => void;
  expandChat: () => void;
}) {
  const horizontal = useSyncExternalStore(subscribe, () => window.matchMedia(desktop).matches, () => true);
  const panelIds = [...(history ? ['history-pane'] : []), 'canvas-pane', ...(chat ? ['chat-pane'] : [])];
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: horizontal ? 'workspace-widths' : 'workspace-heights',
    panelIds,
    onlySaveAfterUserInteractions: true,
  });
  return (
    <div className="flex h-full min-h-0 min-w-0 gap-2">
      {history ? null : <CollapsedRail side="history" expand={expandHistory} />}
      <Group id="workspace-panels" className="min-h-0 min-w-0 flex-1" orientation={horizontal ? 'horizontal' : 'vertical'}
        defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
        {history ? (
          <>
            <Panel id="history-pane" defaultSize={horizontal ? '18%' : '20%'} minSize={horizontal ? '155px' : '84px'}>
              {history}
            </Panel>
            <Separator id="history-splitter" aria-label={horizontal ? '调整历史栏宽度' : '调整历史栏高度'} className="panel-separator" />
          </>
        ) : null}
        <Panel id="canvas-pane" minSize={horizontal ? '240px' : '120px'}>{canvas}</Panel>
        {chat ? (
          <>
            <Separator id="chat-splitter" aria-label={horizontal ? '调整对话栏宽度' : '调整对话栏高度'} className="panel-separator" />
            <Panel id="chat-pane" defaultSize={horizontal ? '29%' : '48%'} minSize={horizontal ? '260px' : '200px'}>
              {chat}
            </Panel>
          </>
        ) : null}
      </Group>
      {chat ? null : <CollapsedRail side="chat" expand={expandChat} />}
    </div>
  );
}
