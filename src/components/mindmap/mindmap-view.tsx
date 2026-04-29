'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { MindMapNode } from '@/lib/agent/types';

type Props = {
  data: MindMapNode | null;
  onChange?: (data: MindMapNode) => void;
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
};

const TAG_COLORS = {
  P0: '#dc2626',
  P1: '#ea580c',
  P2: '#16a34a',
  P3: '#2563eb',
  前置: '#475569',
};

type Priority = 'P0' | 'P1' | 'P2' | 'P3';

const PRECONDITION_TAG = '前置';

const EMPTY_MAP: MindMapNode = {
  data: { text: '@测试用例', uid: 'root', id: 'root' },
  children: [],
};

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
  handleNodeTreeRenderEnd: () => void;
  handleNodeTagClick: (node: MindMapNodeLike, item: MindMapTagItem) => void;
};

type MindMapTagItem = string | { text?: string; value?: string; name?: string };

type MindMapNodeLike = {
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
  view?: {
    scale?: number;
    setScale?: (scale: number) => void;
    fit?: () => void;
    reset?: () => void;
  };
  resize?: () => void;
  setData?: (data: MindMapNode) => void;
  getData?: (withConfig?: boolean) => unknown;
  execCommand?: (command: string, ...args: unknown[]) => void;
  on?: {
    (eventName: 'scale', handler: (scale: number) => void): void;
    (eventName: 'node_tag_click', handler: (node: MindMapNodeLike, item: MindMapTagItem) => void): void;
    (eventName: string, handler: (...args: unknown[]) => void): void;
  };
  off?: {
    (eventName: 'scale', handler: (scale: number) => void): void;
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

function extractPriority(text: string) {
  const match = text.match(/^\s*\[?\s*(P[0-3])\s*\]?\s*[-:：]?/i);
  return match ? (match[1].toUpperCase() as Priority) : null;
}

function stripPriorityPrefix(text: string) {
  return text.replace(/^\s*\[?\s*P[0-3]\s*\]?\s*[-:：]?\s*/i, '').trim();
}

function stripPreconditionPrefix(text: string) {
  return text.replace(/^\s*!\s*/, '').trim();
}

function normalizeTags(tag: unknown) {
  return Array.isArray(tag) ? tag.map(String).filter(Boolean) : [];
}

function firstPriorityFromTags(tags: string[]) {
  return tags.map((tag) => normalizePriority(tag)).find(Boolean) || null;
}

function tagText(item: MindMapTagItem) {
  return typeof item === 'string' ? item : item?.text || item?.value || item?.name || String(item);
}

function normalizeNodeForMindMap(node: MindMapNode | null | undefined, path: number[] = []): MindMapNode {
  const source = node || EMPTY_MAP;
  const rawText = typeof source.data?.text === 'string' && source.data.text.trim() ? source.data.text : '未命名节点';
  const sourceTags = normalizeTags(source.data?.tag);
  const priority = normalizePriority(source.data?.priority) || firstPriorityFromTags(sourceTags) || extractPriority(rawText);
  const uid = source.data?.uid || source.data?.id || (path.length === 0 ? 'root' : `node-${path.join('-')}`);
  const hasPreconditionPrefix = rawText.trim().startsWith('!');
  const hasPreconditionTag = sourceTags.includes(PRECONDITION_TAG) || hasPreconditionPrefix;
  const existingTags = sourceTags.filter((tag) => !normalizePriority(tag) && tag !== PRECONDITION_TAG);
  const displayText = stripPreconditionPrefix(priority ? stripPriorityPrefix(rawText) || rawText : rawText) || rawText;
  const nextTags = [
    ...(priority ? [priority] : []),
    ...(hasPreconditionTag ? [PRECONDITION_TAG] : []),
    ...existingTags,
  ];

  return {
    data: {
      ...source.data,
      text: escapeHtml(displayText),
      uid,
      id: source.data?.id || uid,
      ...(priority ? { priority } : {}),
      ...(nextTags.length > 0 ? { tag: nextTags } : {}),
    },
    children: Array.isArray(source.children)
      ? source.children.map((child, index) => normalizeNodeForMindMap(child, [...path, index]))
      : [],
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
  const rawText = unescapeHtml(String(data.text || data.topic || '未命名节点'));
  const tags = normalizeTags(data.tag);
  const priority = normalizePriority(data.priority) || firstPriorityFromTags(tags) || extractPriority(rawText);
  const hasPreconditionTag = tags.includes(PRECONDITION_TAG) || rawText.trim().startsWith('!');
  const businessTags = tags.filter((tag) => tag !== PRECONDITION_TAG);
  const nextTags = hasPreconditionTag ? [PRECONDITION_TAG, ...businessTags] : businessTags;

  return {
    data: {
      text: stripPreconditionPrefix(priority ? stripPriorityPrefix(rawText) || rawText : rawText) || rawText,
      ...(typeof data.uid === 'string' ? { uid: data.uid } : {}),
      ...(typeof data.id === 'string' ? { id: data.id } : typeof data.uid === 'string' ? { id: data.uid } : {}),
      ...(priority ? { priority } : {}),
      ...(nextTags.length > 0 ? { tag: nextTags } : {}),
    },
    children: children.map((child) => normalizeNodeFromMindMap(child)),
  };
}

function updatePriorityInTree(node: MindMapNode, nodeUid: string, priority: Priority): MindMapNode {
  const uid = node.data.uid || node.data.id;
  const tags = normalizeTags(node.data.tag).filter((tag) => !normalizePriority(tag));
  const nextNode =
    uid === nodeUid
      ? {
          ...node,
          data: {
            ...node.data,
            text: stripPreconditionPrefix(stripPriorityPrefix(node.data.text || '')) || node.data.text,
            priority,
            tag: [priority, ...tags],
          },
        }
      : node;

  return {
    ...nextNode,
    children: nextNode.children.map((child) => updatePriorityInTree(child, nodeUid, priority)),
  };
}

function extractRootData(rawData: unknown) {
  const wrapper = asRawMindMapNode(rawData);
  if (wrapper.root) return wrapper.root;
  return rawData;
}

export const MindMapView = forwardRef<MindMapViewHandle, Props>(function MindMapView(
  { data, onChange, onScaleChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<MindMapInstance | null>(null);
  const currentDataRef = useRef<MindMapNode>(data || EMPTY_MAP);
  const onChangeRef = useRef(onChange);
  const onScaleChangeRef = useRef(onScaleChange);
  const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fitTimerRefs = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const lastSyncedJsonRef = useRef('');
  const mountedRef = useRef(false);
  const programmaticUpdateRef = useRef(false);
  const fitPendingAfterRenderRef = useRef(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [priorityEditor, setPriorityEditor] = useState<PriorityEditorState | null>(null);

  onChangeRef.current = onChange;
  onScaleChangeRef.current = onScaleChange;
  currentDataRef.current = data || EMPTY_MAP;

  const normalizedData = useMemo(() => normalizeNodeForMindMap(data || EMPTY_MAP), [data]);
  const normalizedDataRef = useRef(normalizedData);
  normalizedDataRef.current = normalizedData;

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

    const mindMapData = normalizeNodeForMindMap(nextData);
    const nextJson = JSON.stringify(mindMapData);
    if (nextJson === lastSyncedJsonRef.current && !resetView) return;

    programmaticUpdateRef.current = true;
    try {
      if (resetView) {
        fitPendingAfterRenderRef.current = true;
      }
      instanceRef.current.setData?.(mindMapData);
      lastSyncedJsonRef.current = nextJson;
      if (resetView) {
        scheduleFit(true);
      }
    } finally {
      programmaticUpdateRef.current = false;
    }
  }, [scheduleFit]);

  const changePriority = useCallback((priority: Priority) => {
    if (!priorityEditor || !instanceRef.current) return;

    try {
      const rawData = extractRootData(instanceRef.current.getData?.(true));
      const currentData = normalizeNodeFromMindMap(rawData);
      const nextData = updatePriorityInTree(currentData, priorityEditor.nodeUid, priority);
      setPriorityEditor(null);
      applyData(nextData);
      onChangeRef.current?.(nextData);
    } catch {
      setPriorityEditor(null);
    }
  }, [applyData, priorityEditor]);

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
        view.setScale?.(Math.max((view.scale || 1) - 0.1, 0.5));
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
      undo: () => {
        instanceRef.current?.execCommand?.('BACK');
      },
      redo: () => {
        instanceRef.current?.execCommand?.('FORWARD');
      },
      refresh: () => {
        applyData(currentDataRef.current, true);
      },
    }),
    [applyData, scheduleFit, syncScale],
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
          theme: 'default',
          layout: 'logicalStructure',
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

        const handleDataChange = () => {
          if (programmaticUpdateRef.current) return;
          if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
          changeTimerRef.current = setTimeout(() => {
            if (!instanceRef.current) return;
            try {
              const rawData = extractRootData(instanceRef.current.getData?.(true));
              const nextData = normalizeNodeFromMindMap(rawData);
              lastSyncedJsonRef.current = JSON.stringify(normalizeNodeForMindMap(nextData));
              onChangeRef.current?.(nextData);
            } catch {
              // Ignore transient editor states while the user is typing.
            }
          }, 120);
        };

        const handleScale = (scale: number) => {
          onScaleChangeRef.current?.(Math.round(scale * 100));
        };

        const handleNodeTreeRenderEnd = () => {
          if (!fitPendingAfterRenderRef.current) return;
          fitPendingAfterRenderRef.current = false;
          scheduleFit(true);
        };

        const handleNodeTagClick = (node: MindMapNodeLike, item: MindMapTagItem) => {
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
        instanceRef.current.__handlers = { handleDataChange, handleScale, handleNodeTreeRenderEnd, handleNodeTagClick };

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
  }, [scheduleFit, syncScale]);

  useEffect(() => {
    if (!instanceRef.current) return;
    const nextJson = JSON.stringify(normalizeNodeForMindMap(data || EMPTY_MAP));
    if (nextJson === lastSyncedJsonRef.current) return;
    applyData(data || EMPTY_MAP, true);
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
      if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
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
        }
        instanceRef.current.destroy?.();
        instanceRef.current = null;
      }
      if (container) {
        container.innerHTML = '';
      }
    };
  }, []);

  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden rounded-lg border bg-white">
      {renderError ? <p className="absolute left-3 top-3 z-10 text-xs text-red-600">{renderError}</p> : null}
      {priorityEditor ? (
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
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
});
