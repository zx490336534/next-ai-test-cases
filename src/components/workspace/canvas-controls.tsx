'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, Download, Ellipsis, Expand, FileArchive, FileSpreadsheet, Maximize2, Minimize2, Redo2, RefreshCw, Scan, Shrink, Undo2, ZoomIn, ZoomOut, type LucideIcon } from 'lucide-react';
import type { MindMapViewHandle } from '@/components/mindmap/mindmap-view';
import { NodeSearch } from '@/components/mindmap/node-search';
import type { MindMapNode } from '@/lib/agent/types';

function ActionMenu({ label, trigger, children }: { label: string; trigger: ReactNode; children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  function close(restoreFocus = false) {
    if (!details.current?.open) return;
    details.current.open = false;
    if (restoreFocus) details.current.querySelector('summary')?.focus();
  }
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !details.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return (
    <details className="canvas-menu" ref={details} onKeyDown={(e) => { if (e.key === 'Escape') { close(true); e.stopPropagation(); } }}
      onBlur={(e) => { if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) close(); }}>
      <summary aria-label={label} title={label}>{trigger}</summary>
      <div className="canvas-menu-list" onClick={(e) => {
        if (e.target instanceof Element && e.target.closest('button:enabled')) close(true);
      }}>{children}</div>
    </details>
  );
}

export function CanvasExport({ busy, csv, xmind }: { busy: boolean; csv: () => void; xmind: () => void }) {
  return <ActionMenu label="导出用例" trigger={<><Download size={15} aria-hidden="true" />导出<ChevronDown size={12} aria-hidden="true" /></>}>
    <button type="button" onClick={csv}><FileSpreadsheet size={15} />导出 CSV</button>
    <button type="button" disabled={busy} onClick={xmind}><FileArchive size={15} />{busy ? '正在导出…' : '导出 XMind'}</button>
  </ActionMenu>;
}

export function CanvasControls({ editor, tree, scale, readOnly, fullscreen, toggleFullscreen }: {
  editor: { readonly current: MindMapViewHandle | null }; tree: MindMapNode; scale: number;
  readOnly: boolean; fullscreen: boolean; toggleFullscreen: () => void;
}) {
  const commands: [string, LucideIcon, () => void, boolean?][] = [
    ['撤销', Undo2, () => editor.current?.undo(), readOnly], ['重做', Redo2, () => editor.current?.redo(), readOnly],
    ['展开全部', Expand, () => editor.current?.expandAll()], ['折叠全部', Shrink, () => editor.current?.collapseAll()],
    ['刷新脑图', RefreshCw, () => editor.current?.refresh()],
  ];
  if (typeof document !== 'undefined' && document.fullscreenEnabled) commands.push([fullscreen ? '退出全屏' : '全屏', fullscreen ? Minimize2 : Maximize2, toggleFullscreen]);
  return (
    <div className="canvas-controls" role="group" aria-label="脑图操作">
      <button type="button" aria-label="缩小" title="缩小" onClick={() => editor.current?.zoomOut()}><ZoomOut size={16} /></button>
      <span className="canvas-scale">{scale}%</span>
      <button type="button" aria-label="放大" title="放大" onClick={() => editor.current?.zoomIn()}><ZoomIn size={16} /></button>
      <span className="control-divider" aria-hidden="true" />
      <button type="button" className="fit-control" aria-label="适应画布" title="适应画布" onClick={() => editor.current?.fit()}>
        <Scan size={16} aria-hidden="true" />全图
      </button>
      <NodeSearch tree={tree} onSelect={(id) => editor.current?.locate(id)} />
      <ActionMenu label="更多脑图操作" trigger={<Ellipsis size={17} aria-hidden="true" />}>
        {commands.map(([label, Icon, action, disabled]) => <button type="button" key={label} disabled={disabled} onClick={action}><Icon size={15} aria-hidden="true" />{label}</button>)}
      </ActionMenu>
    </div>
  );
}
