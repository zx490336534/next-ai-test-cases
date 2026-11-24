'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CornerDownRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { EMPTY_MAP, normalizeMindMap } from '@/lib/agent/mindMap';
import type { MindMapNode } from '@/lib/agent/types';

type Props = {
  data: MindMapNode | null;
  onChange?: (data: MindMapNode) => void;
  readOnly?: boolean;
  onSelectionChange?: (id: string | null) => void;
  onScaleChange?: (scalePercent: number) => void;
};

export type MindMapViewHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  resetLayout: () => void;
  expandAll: () => void;
  collapseAll: () => void;
  undo: () => void;
  redo: () => void;
  refresh: () => void;
  locate: (id: string) => void;
  read: () => MindMapNode | undefined;
  isEditing: () => boolean;
};

const TAG_COLORS = {
  P0: '#dc2626',
  P1: '#ea580c',
  P2: '#16a34a',
  P3: '#2563eb',
  前置: '#475569',
};

type Priority = 'P0' | 'P1' | 'P2' | 'P3';

type RawMindMapData = {
  text?: unknown;
  topic?: unknown;
  uid?: unknown;
  id?: unknown;
  tag?: unknown;
  priority?: unknown;
  children?: unknown;
};

type RawMindMapNode = {
  data?: RawMindMapData;
  children?: unknown;
  root?: unknown;
};

type MindMapEventHandlers = {
  handleDataChange: () => void;
  handleScale: (scale: number) => void;
  handleSelection: (node: MindMapNodeLike | null, nodes: MindMapNodeLike[]) => void;
  handleNodeTreeRenderEnd: () => void;
  handleNodeTagClick: (node: MindMapNodeLike, item: MindMapTagItem) => void;
};

type MindMapTagItem = string | { text?: string; value?: string; name?: string };

type MindMapNodeLike = {
  isRoot?: boolean;
  nodeData?: {
    data?: RawMindMapData;
  };
  data?: RawMindMapData;
  group?: {
    node?: Element;
    el?: Element;
  };
};

type MindMapInstance = {
  keyCommand?: { removeShortcut: (key: string) => void; addShortcut: (key: string, action: () => void) => void };
  renderer?: {
    activeNodeList: MindMapNodeLike[];
    textEdit?: {
      show: (input: { node: MindMapNodeLike }) => Promise<void>;
      isShowTextEdit: () => boolean;
    };
  };
  view?: {
    scale?: number;
    setScale?: (scale: number) => void;
    fit?: () => void;
    reset?: () => void;
  };
  resize?: () => void;
  updateData?: (data: MindMapNode) => void;
  setMode?: (mode: 'readonly' | 'edit') => void;
  getData?: (withConfig?: boolean) => unknown;
  execCommand?: (command: string, ...args: unknown[]) => void;
  on?: {
    (eventName: 'scale', handler: (scale: number) => void): void;
    (eventName: 'node_active', handler: MindMapEventHandlers['handleSelection']): void;
    (eventName: 'node_tag_click', handler: (node: MindMapNodeLike, item: MindMapTagItem) => void): void;
    (eventName: string, handler: (...args: unknown[]) => void): void;
  };
  off?: {
    (eventName: 'scale', handler: (scale: number) => void): void;
    (eventName: 'node_active', handler: MindMapEventHandlers['handleSelection']): void;
    (eventName: 'node_tag_click', handler: (node: MindMapNodeLike, item: MindMapTagItem) => void): void;
    (eventName: string, handler?: (...args: unknown[]) => void): void;
  };
  destroy?: () => void;
  __handlers?: MindMapEventHandlers;
};

type MindMapConstructor = new (opts: unknown) => MindMapInstance;

type PriorityEditorState = {
  x: number;
  y: number;
  nodeUid: string;
  currentPriority: Priority;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function unescapeHtml(value: string) {
  if (typeof document === 'undefined') return value;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function normalizePriority(value: unknown): Priority | null {
  if (typeof value !== 'string') return null;
  const priority = value.trim().toUpperCase();
  return priority === 'P0' || priority === 'P1' || priority === 'P2' || priority === 'P3' ? priority : null;
}

function tagText(item: MindMapTagItem) {
  return typeof item === 'string' ? item : item?.text || item?.value || item?.name || String(item);
}

function nodeForEditor(node: MindMapNode): MindMapNode {
  return {
    data: { ...node.data, text: escapeHtml(node.data.text) },
    children: node.children.map(nodeForEditor),
  };
}

function asRawMindMapNode(node: unknown): RawMindMapNode {
  return node && typeof node === 'object' ? (node as RawMindMapNode) : {};
}

function asRawMindMapData(data: unknown): RawMindMapData {
  return data && typeof data === 'object' ? (data as RawMindMapData) : {};
}

function normalizeNodeFromMindMap(node: unknown): MindMapNode {
  const wrapper = asRawMindMapNode(node);
  const data = wrapper.data ? asRawMindMapData(wrapper.data) : asRawMindMapData(node);
  const children = Array.isArray(wrapper.children)
    ? wrapper.children
    : Array.isArray(data.children)
      ? data.children
      : [];
  return {
    data: {
      text: unescapeHtml(String(data.text || data.topic || '')),
      ...(typeof data.uid === 'string' && { uid: data.uid }),
      ...(typeof data.id === 'string' && { id: data.id }),
      ...(normalizePriority(data.priority) && { priority: normalizePriority(data.priority)! }),
      ...(Array.isArray(data.tag) && { tag: data.tag.map(tagText) }),
    },
    children: children.map(normalizeNodeFromMindMap),
  };
}

function changeNodePriority(node: MindMapNode, uid: string, priority: Priority): MindMapNode {
  if (node.data.uid === uid) return { ...node, data: { ...node.data, priority } };
  return { ...node, children: node.children.map((child) => changeNodePriority(child, uid, priority)) };
}

function extractRootData(rawData: unknown) {
  const wrapper = asRawMindMapNode(rawData);
  if (wrapper.root) return wrapper.root;
  return rawData;
}

export const MindMapView = forwardRef<MindMapViewHandle, Props>(function MindMapView(
  { data, onChange, onScaleChange, onSelectionChange, readOnly = false },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<MindMapInstance | null>(null);
  const currentDataRef = useRef<MindMapNode>(data || EMPTY_MAP);
  const onChangeRef = useRef(onChange);
  const onScaleChangeRef = useRef(onScaleChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const selectionRef = useRef<MindMapNodeLike[]>([]);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fitTimerRefs = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const lastSyncedJsonRef = useRef('');
  const showingCasesRef = useRef(false);
  const mountedRef = useRef(false);
  const programmaticUpdateRef = useRef(false);
  const fitPendingAfterRenderRef = useRef(false);
  const [selection, setSelection] = useState<{ root: boolean; count: number } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [priorityEditor, setPriorityEditor] = useState<PriorityEditorState | null>(null);

  const normalizedData = useMemo(() => nodeForEditor(data || EMPTY_MAP), [data]);
  const normalizedDataRef = useRef(normalizedData);
  const readOnlyRef = useRef(readOnly);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    onScaleChangeRef.current = onScaleChange;
    onSelectionChangeRef.current = onSelectionChange;
    currentDataRef.current = data || EMPTY_MAP;
    normalizedDataRef.current = normalizedData;
    readOnlyRef.current = readOnly;
    instanceRef.current?.setMode?.(readOnly ? 'readonly' : 'edit');
  }, [data, normalizedData, onChange, onScaleChange, onSelectionChange, readOnly]);

  const read = useCallback(() => {
    if (!instanceRef.current) return undefined;
    const raw = extractRootData(instanceRef.current.getData?.(true));
    return raw ? normalizeMindMap(normalizeNodeFromMindMap(raw)) : undefined;
  }, []);

  const scheduleFit = useCallback((resetView = false) => {
    fitTimerRefs.current.forEach((timer) => clearTimeout(timer));
    fitTimerRefs.current = [];

    let didReset = false;
    const fit = () => {
      if (!mountedRef.current) return;
      const instance = instanceRef.current;
      if (!instance) return;

      try {
        instance.resize?.();
        if (resetView && !didReset) {
          instance.view?.reset?.();
          didReset = true;
        }
        instance.view?.fit?.();
        const scale = instance.view?.scale;
        if (typeof scale === 'number') {
          onScaleChangeRef.current?.(Math.round(scale * 100));
        }
      } catch {
        // fit is best-effort only; rendering should not fail because of it.
      }
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fit();
      });
    });

    fitTimerRefs.current = [
      setTimeout(fit, 120),
      setTimeout(fit, 320),
      setTimeout(fit, 640),
    ];
  }, []);

  const syncScale = useCallback(() => {
    const scale = instanceRef.current?.view?.scale;
    if (typeof scale === 'number') {
      onScaleChangeRef.current?.(Math.round(scale * 100));
    }
  }, []);

  const applyData = useCallback((nextData: MindMapNode, resetView = false) => {
    if (!instanceRef.current) return;

    const mindMapData = nodeForEditor(nextData);
    const hasChildren = nextData.children.length > 0;
    const firstContent = !showingCasesRef.current && hasChildren;
    showingCasesRef.current = hasChildren;
    resetView ||= firstContent;
    const nextJson = JSON.stringify(mindMapData);
    if (nextJson === lastSyncedJsonRef.current && !resetView) return;

    programmaticUpdateRef.current = true;
    try {
      if (resetView) {
        fitPendingAfterRenderRef.current = true;
      }
      if (nextJson !== lastSyncedJsonRef.current) instanceRef.current.updateData?.(mindMapData);
      lastSyncedJsonRef.current = nextJson;
      if (resetView) {
        scheduleFit(true);
      }
    } finally {
      programmaticUpdateRef.current = false;
    }
  }, [scheduleFit]);

  const changePriority = useCallback((priority: Priority) => {
    if (!priorityEditor || readOnlyRef.current) return;

    try {
      const currentData = read();
      if (!currentData) return;
      const nextData = normalizeMindMap(changeNodePriority(currentData, priorityEditor.nodeUid, priority));
      setPriorityEditor(null);
      applyData(nextData);
      onChangeRef.current?.(nextData);
    } catch {
      setPriorityEditor(null);
    }
  }, [applyData, priorityEditor, read]);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => {
        const view = instanceRef.current?.view;
        if (!view) return;
        view.setScale?.(Math.min((view.scale || 1) + 0.1, 3));
        syncScale();
      },
      zoomOut: () => {
        const view = instanceRef.current?.view;
        if (!view) return;
        view.setScale?.(Math.max((view.scale || 1) - 0.1, 0.1));
        syncScale();
      },
      fit: () => {
        instanceRef.current?.view?.fit?.();
        syncScale();
      },
      resetLayout: () => {
        instanceRef.current?.execCommand?.('RESET_LAYOUT');
        scheduleFit();
      },
      expandAll: () => {
        instanceRef.current?.execCommand?.('EXPAND_ALL');
      },
      collapseAll: () => {
        instanceRef.current?.execCommand?.('UNEXPAND_ALL', false);
        scheduleFit();
      },
      read,
      isEditing: () => instanceRef.current?.renderer?.textEdit?.isShowTextEdit() ?? false,
      undo: () => {
        if (readOnlyRef.current) return;
        instanceRef.current?.execCommand?.('BACK');
      },
      redo: () => {
        if (readOnlyRef.current) return;
        instanceRef.current?.execCommand?.('FORWARD');
      },
      locate: (id) => instanceRef.current?.execCommand?.('GO_TARGET_NODE', id),
      refresh: () => {
        applyData(currentDataRef.current, true);
      },
    }),
    [applyData, read, scheduleFit, syncScale],
  );

  useEffect(() => {
    mountedRef.current = true;

    async function initMindMap(retryCount = 0) {
      if (!containerRef.current || instanceRef.current || !mountedRef.current) {
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      if ((rect.width <= 0 || rect.height <= 0) && retryCount < 12) {
        retryTimerRef.current = setTimeout(() => void initMindMap(retryCount + 1), 100);
        return;
      }

      try {
        setRenderError(null);
        await import('simple-mind-map/dist/simpleMindMap.esm.css');
        const smm = (await import('simple-mind-map')) as unknown as {
          default?: MindMapConstructor;
          MindMap?: MindMapConstructor;
        };
        const MindMap = smm.default ?? smm.MindMap;

        if (!MindMap) {
          throw new Error('simple-mind-map 加载失败');
        }

        if (!mountedRef.current || !containerRef.current) return;

        containerRef.current.innerHTML = '';
        const initialData = normalizedDataRef.current;
        fitPendingAfterRenderRef.current = true;
        instanceRef.current = new MindMap({
          el: containerRef.current,
          data: initialData,
          readonly: readOnlyRef.current,
          theme: 'default',
          themeConfig: {
            backgroundColor: 'transparent', lineColor: '#7ca5a1',
            root: { fillColor: '#156f68', color: '#ffffff' },
            second: { fillColor: '#f2f9f8', color: '#193637' },
          },
          defaultInsertSecondLevelNodeText: '新模块',
          defaultInsertBelowSecondLevelNodeText: '新节点',
          layout: 'logicalStructure',
          resetScaleOnMoveNodeToCenter: false,
          fit: true,
          nodeTextEditZIndex: 1000,
          tagsColorMap: TAG_COLORS,
          maxHistoryCount: 100,
          addHistoryTime: 200,
          mousewheelAction: 'zoom',
          mousewheelZoomActionReverse: false,
          enableCtrlKeyNodeSelection: true,
          enableAutoEnterTextEditWhenKeydown: true,
          openRealtimeRenderOnNodeTextEdit: true,
        });
        lastSyncedJsonRef.current = JSON.stringify(initialData);
        showingCasesRef.current = initialData.children.length > 0;
        const instance = instanceRef.current;
        const deleteKeys = 'Del|Backspace|Shift+Backspace';
        instance.keyCommand?.removeShortcut(deleteKeys);
        instance.keyCommand?.addShortcut(deleteKeys, () => {
          const selected = instance.renderer?.activeNodeList ?? [];
          if (selected.length && selected.every((node) => !node.isRoot)) instance.execCommand?.('REMOVE_NODE', [...selected]);
        });

        const handleDataChange = () => {
          if (programmaticUpdateRef.current || readOnlyRef.current) return;
          const nextData = read();
          if (!nextData) return;
          const json = JSON.stringify(nodeForEditor(nextData));
          if (json === lastSyncedJsonRef.current) return;
          lastSyncedJsonRef.current = json;
          onChangeRef.current?.(nextData);
        };

        const handleScale = (scale: number) => {
          onScaleChangeRef.current?.(Math.round(scale * 100));
        };

        const handleSelection: MindMapEventHandlers['handleSelection'] = (_, nodes) => {
          selectionRef.current = nodes;
          const only = nodes.length === 1 ? nodes[0] : undefined;
          const uid = only?.nodeData?.data?.uid ?? only?.data?.uid;
          setSelection(nodes.length ? { root: nodes.some((node) => !!node.isRoot), count: nodes.length } : null);
          onSelectionChangeRef.current?.(typeof uid === 'string' ? uid : null);
        };

        const handleNodeTreeRenderEnd = () => {
          if (!fitPendingAfterRenderRef.current) return;
          fitPendingAfterRenderRef.current = false;
          scheduleFit(true);
        };

        const handleNodeTagClick = (node: MindMapNodeLike, item: MindMapTagItem) => {
          if (readOnlyRef.current) return;
          const priority = normalizePriority(tagText(item));
          if (!priority) return;

          const nodeData = node?.nodeData?.data || node?.data || {};
          const nodeUid = typeof nodeData.uid === 'string' ? nodeData.uid : typeof nodeData.id === 'string' ? nodeData.id : '';
          const wrapperEl = containerRef.current?.parentElement;
          if (!nodeUid || !wrapperEl) return;

          const wrapperRect = wrapperEl.getBoundingClientRect();
          const groupEl = node.group?.node || node.group?.el;

          if (groupEl) {
            const bbox = groupEl.getBoundingClientRect();
            if (bbox.width > 0 && bbox.height > 0) {
              setPriorityEditor({
                x: Math.max(8, bbox.left - wrapperRect.left),
                y: Math.max(8, bbox.bottom - wrapperRect.top + 4),
                currentPriority: priority,
                nodeUid,
              });
              return;
            }
          }

          setPriorityEditor({
            x: Math.max(16, Math.round(wrapperRect.width / 2) - 78),
            y: Math.max(16, Math.round(wrapperRect.height / 2) - 18),
            currentPriority: priority,
            nodeUid,
          });
        };

        instanceRef.current.on?.('data_change', handleDataChange);
        instanceRef.current.on?.('scale', handleScale);
        instanceRef.current.on?.('node_tree_render_end', handleNodeTreeRenderEnd);
        instanceRef.current.on?.('node_tag_click', handleNodeTagClick);
        instanceRef.current.on?.('node_active', handleSelection);
        instanceRef.current.__handlers = { handleDataChange, handleScale, handleNodeTreeRenderEnd, handleNodeTagClick, handleSelection };

        syncScale();
        scheduleFit(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : '脑图渲染失败';
        setRenderError(message);
      }
    }

    void initMindMap();

    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [read, scheduleFit, syncScale]);

  useEffect(() => {
    if (!instanceRef.current) return;
    const nextJson = JSON.stringify(nodeForEditor(data || EMPTY_MAP));
    if (nextJson === lastSyncedJsonRef.current) return;
    applyData(data || EMPTY_MAP);
  }, [applyData, data]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    resizeObserverRef.current = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      try {
        instanceRef.current?.resize?.();
      } catch {
        // simple-mind-map throws when layout is between hidden and visible states.
      }
    });
    resizeObserverRef.current.observe(container);

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      fitTimerRefs.current.forEach((timer) => clearTimeout(timer));
      fitTimerRefs.current = [];
      if (instanceRef.current) {
        const handlers = instanceRef.current.__handlers;
        if (handlers) {
          instanceRef.current.off?.('data_change', handlers.handleDataChange);
          instanceRef.current.off?.('scale', handlers.handleScale);
          instanceRef.current.off?.('node_tree_render_end', handlers.handleNodeTreeRenderEnd);
          instanceRef.current.off?.('node_tag_click', handlers.handleNodeTagClick);
          instanceRef.current.off?.('node_active', handlers.handleSelection);
        }
        instanceRef.current.destroy?.();
        instanceRef.current = null;
      }
      if (container) {
        container.innerHTML = '';
      }
    };
  }, []);

  function edit(command: 'rename' | 'child' | 'sibling' | 'up' | 'down' | 'delete') {
    const instance = instanceRef.current;
    const nodes = selectionRef.current;
    if (!instance || readOnly || !nodes.length) return;
    const [current] = nodes;
    if (command === 'rename') {
      if (nodes.length === 1 && !current.isRoot) void instance.renderer?.textEdit?.show({ node: current });
      return;
    }
    if (command === 'child' || command === 'sibling') {
      if (command === 'sibling' && nodes.some((node) => node.isRoot)) return;
      instance.execCommand?.(command === 'child' ? 'INSERT_CHILD_NODE' : 'INSERT_NODE', true, [...nodes]);
      return;
    }
    if (nodes.some((node) => node.isRoot)) return;
    if (command === 'delete') instance.execCommand?.('REMOVE_NODE', [...nodes]);
    else if (nodes.length === 1) instance.execCommand?.(command === 'up' ? 'UP_NODE' : 'DOWN_NODE', current);
  }

  const nodeTools = [
    { command: 'rename', label: '编辑文字', icon: Pencil, single: true, root: false },
    { command: 'child', label: '新增下级', icon: CornerDownRight, single: false, root: true },
    { command: 'sibling', label: '新增同级', icon: Plus, single: false, root: false },
    { command: 'up', label: '上移节点', icon: ArrowUp, single: true, root: false },
    { command: 'down', label: '下移节点', icon: ArrowDown, single: true, root: false },
    { command: 'delete', label: '删除节点', icon: Trash2, single: false, root: false },
  ] as const;

  return (
    <div className="mindmap-grid relative h-full w-full overflow-hidden rounded-xl border border-[#dce8e7] bg-[#f7faf9]">
      {renderError ? <p className="absolute left-3 top-3 z-10 text-xs text-red-600">{renderError}</p> : null}
      {priorityEditor && !readOnly ? (
        <div
          className="absolute z-20 flex items-center gap-1 rounded-lg border bg-white p-1 shadow-lg"
          style={{ left: priorityEditor.x, top: priorityEditor.y }}
        >
          {(['P0', 'P1', 'P2', 'P3'] as const).map((priority) => (
            <button
              key={priority}
              type="button"
              className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium ${
                priorityEditor.currentPriority === priority ? 'bg-slate-100 text-slate-950' : 'text-slate-600 hover:bg-slate-50'
              }`}
              onClick={() => changePriority(priority)}
              title={`修改为 ${priority}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TAG_COLORS[priority] }} />
              {priority}
            </button>
          ))}
        </div>
      ) : null}
      <div ref={containerRef} className="h-full w-full" aria-label="测试用例脑图画布" />
      {selection && !readOnly ? (
        <div role="toolbar" aria-label="节点操作" onMouseDown={(event) => event.preventDefault()}
          className="absolute bottom-4 left-4 z-10 flex max-w-[calc(100%-2rem)] flex-wrap gap-0.5 rounded-xl border border-[#dce8e7] bg-white p-1.5 shadow-lg shadow-[#173938]/8">
          {nodeTools.filter((item) => (item.root || !selection.root) && (!item.single || selection.count === 1)).map(({ command, icon: Icon, label }) => (
            <button type="button" key={command} aria-label={label} title={label}
              className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-slate-700 hover:bg-[#eaf4f2] focus-visible:outline-2 focus-visible:outline-offset-1"
              onClick={() => edit(command)}>
              <Icon className="h-3.5 w-3.5" aria-hidden="true" /> <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
});
