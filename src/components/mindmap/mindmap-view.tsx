'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { ArrowDown, ArrowUp, CornerDownRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { EMPTY_MAP, normalizeMindMap } from '@/lib/agent/mindMap';
import type { MindMapNode } from '@/lib/agent/types';

type Props = {
  data: MindMapNode | null;
  onChange?: (data: MindMapNode) => void;
  readOnly?: boolean;
  compact?: boolean;
  onSelectionChange?: (id: string | null) => void;
  onNodeClick?: (id: string) => void;
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
  finishTextEdit: () => void;
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
  handleNodeClick: (node: MindMapNodeLike) => void;
  handleNodeTagClick: (node: MindMapNodeLike, item: MindMapTagItem) => void;
};

type MindMapTagItem = string | { text?: string; value?: string; name?: string };

type MindMapNodeLike = {
  isRoot?: boolean;
  children?: MindMapNodeLike[];
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
    root?: MindMapNodeLike;
    textEdit?: {
      show: (input: { node: MindMapNodeLike }) => Promise<void>;
      isShowTextEdit: () => boolean;
      hideEditTextBox: () => void;
    };
  };
  view?: {
    scale?: number;
    setScale?: (scale: number, x?: number, y?: number) => void;
    translateXY?: (x: number, y: number) => void;
    fit?: () => void;
  };
  resize?: () => void;
  updateData?: (data: MindMapNode) => void;
  setMode?: (mode: 'readonly' | 'edit') => void;
  getData?: (withConfig?: boolean) => unknown;
  execCommand?: (command: string, ...args: unknown[]) => void;
  on?: {
    (eventName: 'scale', handler: (scale: number) => void): void;
    (eventName: 'node_active', handler: MindMapEventHandlers['handleSelection']): void;
    (eventName: 'node_click', handler: MindMapEventHandlers['handleNodeClick']): void;
    (eventName: 'node_tag_click', handler: (node: MindMapNodeLike, item: MindMapTagItem) => void): void;
    (eventName: string, handler: (...args: unknown[]) => void): void;
  };
  off?: {
    (eventName: 'scale', handler: (scale: number) => void): void;
    (eventName: 'node_active', handler: MindMapEventHandlers['handleSelection']): void;
    (eventName: 'node_click', handler: MindMapEventHandlers['handleNodeClick']): void;
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

function firstVisibleCase(root: MindMapNodeLike) {
  for (const moduleNode of root.children ?? []) {
    for (const precondition of moduleNode.children ?? []) {
      for (const test of precondition.children ?? []) {
        const group = test.group?.node ?? test.group?.el;
        const step = test.children?.[0]?.group;
        const bounds = group?.getBoundingClientRect();
        if (bounds?.width && step) return { bounds, step: (step.node ?? step.el)?.getBoundingClientRect() };
      }
    }
  }
}

export const MindMapView = forwardRef<MindMapViewHandle, Props>(function MindMapView(
  { data, onChange, onScaleChange, onSelectionChange, onNodeClick, readOnly = false, compact = false },
  ref,
) {
  const gestureRef = useRef<{ x: number; y: number; distance: number | null } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<MindMapInstance | null>(null);
  const currentDataRef = useRef<MindMapNode>(data || EMPTY_MAP);
  const onChangeRef = useRef(onChange);
  const onScaleChangeRef = useRef(onScaleChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onNodeClickRef = useRef(onNodeClick);
  const selectionRef = useRef<MindMapNodeLike[]>([]);
  const lastSyncedJsonRef = useRef('');
  const showingCasesRef = useRef(false);
  const programmaticUpdateRef = useRef(false);
  const pendingView = useRef<'reading' | 'overview' | null>('reading');
  const [selection, setSelection] = useState<{ root: boolean; count: number } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [priorityEditor, setPriorityEditor] = useState<PriorityEditorState | null>(null);
  const [focusedTool, setFocusedTool] = useState('rename');

  const normalizedData = useMemo(() => nodeForEditor(data || EMPTY_MAP), [data]);
  const normalizedDataRef = useRef(normalizedData);
  const readOnlyRef = useRef(readOnly);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    onScaleChangeRef.current = onScaleChange;
    onSelectionChangeRef.current = onSelectionChange;
    onNodeClickRef.current = onNodeClick;
    currentDataRef.current = data || EMPTY_MAP;
    normalizedDataRef.current = normalizedData;
    readOnlyRef.current = readOnly;
    instanceRef.current?.setMode?.(readOnly ? 'readonly' : 'edit');
  }, [data, normalizedData, onChange, onScaleChange, onSelectionChange, onNodeClick, readOnly]);

  const read = useCallback(() => {
    if (!instanceRef.current) return undefined;
    const raw = extractRootData(instanceRef.current.getData?.(true));
    return raw ? normalizeMindMap(normalizeNodeFromMindMap(raw)) : undefined;
  }, []);

  const frameCanvas = useCallback((mode: 'reading' | 'overview') => {
    const instance = instanceRef.current;
    const view = instance?.view;
    const root = instance?.renderer?.root;
    const canvas = containerRef.current?.getBoundingClientRect();
    const rootElement = root?.group?.node ?? root?.group?.el;
    if (!view || !canvas?.width || !canvas.height || !rootElement?.getBoundingClientRect().width) return;
    pendingView.current = null;
    view.fit?.();
    // Keep small trees in full view. Open larger trees at a scale suitable for reading.
    const shallow = root?.children?.every((moduleNode) => !moduleNode.children?.length);
    if (mode === 'reading' && view.scale && view.scale < (shallow ? 0.75 : 0.9)) {
      view.setScale?.(1);
      const firstCase = canvas.width < 560 && root ? firstVisibleCase(root) : undefined;
      if (firstCase) {
        const { bounds, step } = firstCase;
        const firstRow = step && bounds.bottom - step.top < canvas.height * 0.65 ? Math.min(bounds.top, step.top) : bounds.top;
        view.translateXY?.(canvas.left + 14 - bounds.left, canvas.top + canvas.height * 0.24 - firstRow);
        return;
      }
      const bounds = rootElement.getBoundingClientRect();
      const rootY = bounds.top + bounds.height / 2;
      const modules = (root?.children ?? []).flatMap(({ group }) => {
        const rect = (group?.node ?? group?.el)?.getBoundingClientRect();
        return rect?.width ? [{ left: rect.left, y: rect.top + rect.height / 2 }] : [];
      });
      const first = modules[0] ?? { left: bounds.left, y: rootY };
      const nearest = modules.reduce((best, item) =>
        Math.abs(item.y - rootY) < Math.abs(best.y - rootY) ? item : best, first);
      const showRoot = Math.abs(nearest.y - rootY) < canvas.height - 80;
      // A very tall tree can put every module outside the root's viewport. Open the first module there.
      const anchorY = showRoot ? (rootY + nearest.y) / 2 : first.y;
      const anchorLeft = showRoot ? bounds.left : first.left;
      const left = canvas.width < 480 ? 16 : 32;
      view.translateXY?.(canvas.left + left - anchorLeft, canvas.top + canvas.height / 2 - anchorY);
    }
  }, []);

  const cancelPendingView = () => { pendingView.current = null; };

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
        pendingView.current = 'reading';
      }
      if (nextJson !== lastSyncedJsonRef.current) instanceRef.current.updateData?.(mindMapData);
      else if (resetView) frameCanvas('reading');
      lastSyncedJsonRef.current = nextJson;
    } finally {
      programmaticUpdateRef.current = false;
    }
  }, [frameCanvas]);

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
        cancelPendingView();
        view.setScale?.(Math.min((view.scale || 1) + 0.1, 3));
        syncScale();
      },
      zoomOut: () => {
        const view = instanceRef.current?.view;
        if (!view) return;
        cancelPendingView();
        view.setScale?.(Math.max((view.scale || 1) - 0.1, 0.1));
        syncScale();
      },
      fit: () => {
        pendingView.current = 'overview';
        frameCanvas('overview');
      },
      resetLayout: () => {
        pendingView.current = 'overview';
        instanceRef.current?.execCommand?.('RESET_LAYOUT');
      },
      expandAll: () => {
        instanceRef.current?.execCommand?.('EXPAND_ALL');
      },
      collapseAll: () => {
        pendingView.current = 'overview';
        instanceRef.current?.execCommand?.('UNEXPAND_ALL', false);
      },
      read,
      isEditing: () => instanceRef.current?.renderer?.textEdit?.isShowTextEdit() ?? false,
      finishTextEdit: () => instanceRef.current?.renderer?.textEdit?.hideEditTextBox(),
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
    [applyData, frameCanvas, read, syncScale],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let loading = false;

    async function initMindMap() {
      if (!container || instanceRef.current || loading || disposed) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      loading = true;
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

        if (disposed || !container.getBoundingClientRect().width || !container.getBoundingClientRect().height) return;

        container.replaceChildren();
        const initialData = normalizedDataRef.current;
        pendingView.current = 'reading';
        instanceRef.current = new MindMap({
          el: container,
          data: initialData,
          readonly: readOnlyRef.current,
          theme: 'default',
          themeConfig: {
            backgroundColor: 'transparent', lineColor: '#aaaac7',
            root: { fillColor: '#4540a0', color: '#ffffff', fontSize: 18, borderRadius: 8 },
            second: { fillColor: '#efedfc', color: '#25283d', borderColor: '#d4d0eb', marginX: 30, marginY: 24, borderRadius: 6 },
            node: { color: '#25283d', marginX: 21, paddingX: 9 },
          },
          defaultInsertSecondLevelNodeText: '新模块',
          defaultInsertBelowSecondLevelNodeText: '新节点',
          layout: 'logicalStructure',
          resetScaleOnMoveNodeToCenter: false,
          fit: false,
          fitPadding: 20,
          hoverRectColor: '#7166c0',
          nodeTextEditZIndex: 1000,
          tagsColorMap: TAG_COLORS,
          maxHistoryCount: 100,
          addHistoryTime: 200,
          mousewheelAction: 'zoom',
          textAutoWrapWidth: rect.width < 560 ? Math.max(108, Math.min(180, (rect.width - 120) / 2)) : 300,
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

        const handleNodeClick = (node: MindMapNodeLike) => {
          const uid = node.nodeData?.data?.uid ?? node.data?.uid;
          if (typeof uid === 'string') onNodeClickRef.current?.(uid);
        };

        const handleNodeTreeRenderEnd = () => {
          if (pendingView.current) frameCanvas(pendingView.current);
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
                x: Math.max(4, Math.min(wrapperRect.width - 224, bbox.left - wrapperRect.left)),
                y: Math.max(4, Math.min(wrapperRect.height - 58, bbox.bottom - wrapperRect.top + 4)),
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
        instanceRef.current.on?.('node_click', handleNodeClick);
        instanceRef.current.__handlers = { handleDataChange, handleScale, handleNodeTreeRenderEnd, handleNodeTagClick, handleSelection, handleNodeClick };

        syncScale();
      } catch (error) {
        const message = error instanceof Error ? error.message : '脑图渲染失败';
        if (!disposed) setRenderError(message);
      } finally {
        loading = false;
      }
    }

    void initMindMap();

    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (instanceRef.current) instanceRef.current.resize?.();
      else void initMindMap();
    });
    observer.observe(container);

    return () => {
      disposed = true;
      observer.disconnect();
      if (instanceRef.current) {
        const handlers = instanceRef.current.__handlers;
        if (handlers) {
          instanceRef.current.off?.('data_change', handlers.handleDataChange);
          instanceRef.current.off?.('scale', handlers.handleScale);
          instanceRef.current.off?.('node_tree_render_end', handlers.handleNodeTreeRenderEnd);
          instanceRef.current.off?.('node_tag_click', handlers.handleNodeTagClick);
          instanceRef.current.off?.('node_active', handlers.handleSelection);
          instanceRef.current.off?.('node_click', handlers.handleNodeClick);
        }
        instanceRef.current.destroy?.();
        instanceRef.current = null;
      }
      container.replaceChildren();
    };
  }, [frameCanvas, read, syncScale]);

  useEffect(() => {
    if (!instanceRef.current) return;
    const nextJson = JSON.stringify(nodeForEditor(data || EMPTY_MAP));
    if (nextJson !== lastSyncedJsonRef.current) applyData(data || EMPTY_MAP);
  }, [applyData, data]);

  function trackGesture(event: TouchEvent<HTMLDivElement>) {
    const [first, second] = Array.from(event.touches);
    const view = instanceRef.current?.view;
    if (!view || !first || event.touches.length > 2 || event.type === 'touchcancel') {
      gestureRef.current = null;
      return;
    }
    const next = second ? {
      x: (first.clientX + second.clientX) / 2,
      y: (first.clientY + second.clientY) / 2,
      distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY),
    } : { x: first.clientX, y: first.clientY, distance: null };
    const before = gestureRef.current;
    gestureRef.current = next;
    if (event.type !== 'touchmove' || !before || (before.distance === null) !== (next.distance === null)) return;

    if (before.distance && next.distance && view.scale) {
      const rect = event.currentTarget.getBoundingClientRect();
      const scale = Math.min(3, Math.max(0.1, view.scale * next.distance / before.distance));
      view.setScale?.(scale, before.x - rect.left, before.y - rect.top);
    }
    view.translateXY?.(next.x - before.x, next.y - before.y);
  }

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
  const tools = selection ? nodeTools.filter((item) => (item.root || !selection.root) && (!item.single || selection.count === 1)) : [];
  const tabStop = tools.find(({ command }) => command === focusedTool) ?? tools[0];
  const nativeToolbar = typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype;

  return (
    <div className="mindmap-grid @container/map relative h-full w-full overflow-hidden">
      {renderError ? <p className="absolute left-3 top-3 z-10 text-xs text-red-600">{renderError}</p> : null}
      {priorityEditor && !readOnly ? (
        <div role="group" aria-label="修改优先级"
          className="absolute z-20 flex max-w-[calc(100%-0.5rem)] flex-wrap items-center gap-1 rounded-lg border border-[#dcdbe7] bg-white p-1 shadow-sm"
          style={{ left: priorityEditor.x, top: priorityEditor.y }}
        >
          {(['P0', 'P1', 'P2', 'P3'] as const).map((priority) => (
            <button
              key={priority}
              type="button"
              aria-pressed={priorityEditor.currentPriority === priority}
              className={`flex min-h-8 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${
                priorityEditor.currentPriority === priority ? 'bg-[#efedfc] text-[#4540a0]' : 'text-[#48495e] hover:bg-[#f6f5fa]'
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
      <div ref={containerRef} className="h-full w-full touch-none" aria-label="测试用例脑图画布"
        onPointerDownCapture={cancelPendingView} onWheelCapture={cancelPendingView}
        onTouchStart={trackGesture} onTouchMove={trackGesture} onTouchEnd={trackGesture} onTouchCancel={trackGesture} />
      {compact && !selection && (
        <p className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-white/90 px-2 py-1 text-xs text-slate-600 [@media(pointer:fine)]:hidden">
          拖动画布 · 双指缩放
        </p>
      )}
      {selection && !readOnly ? (
        <div role="toolbar" aria-label="节点操作" {...{ focusgroup: 'toolbar wrap' }} onMouseDown={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (nativeToolbar || !(event.target instanceof HTMLButtonElement)) return;
            const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
            const index = buttons.indexOf(event.target);
            const offsets: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: buttons.length - 1 };
            if (!Object.hasOwn(offsets, event.key)) return;
            event.preventDefault();
            buttons[(offsets[event.key] + buttons.length) % buttons.length]?.focus();
          }}
          className="absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap gap-0.5 rounded-lg border border-[#dcdbe7] bg-white p-1 shadow-sm">
          {tools.map(({ command, icon: Icon, label }) => (
            <button type="button" key={command} aria-label={label} title={label}
              tabIndex={nativeToolbar ? undefined : command === tabStop?.command ? 0 : -1} onFocus={() => setFocusedTool(command)}
              className="flex min-h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-xs text-[#393951] hover:bg-[#efedfc] focus-visible:outline-2 focus-visible:outline-[#615ab0] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
              onClick={() => edit(command)}>
              <Icon className="h-3.5 w-3.5" aria-hidden="true" /> <span className="hidden @[34rem]/map:inline">{label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
});
