'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Download,
  Expand,
  FileArchive,
  Loader2,
  Maximize2,
  MessageSquare,
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
import { MindMapView, type MindMapViewHandle } from '@/components/mindmap/mindmap-view';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { ChatMessage, MindMapNode, TestCaseItem, TestCaseModulePlan } from '@/lib/agent/types';

const REQUIREMENT_TEMPLATES = [
  {
    label: '登录',
    content: `模块：登录
需求：支持手机号+验证码登录。
规则：验证码5分钟有效，1分钟内同一手机号最多发送1次，连续输错5次锁定10分钟。`,
  },
  {
    label: '注册',
    content: `模块：注册
需求：支持手机号注册并设置密码。
规则：密码至少8位，包含字母和数字；手机号唯一。`,
  },
  {
    label: '搜索',
    content: `模块：搜索
需求：支持关键字搜索、筛选和排序。
规则：空关键字给出默认推荐；分页每页20条。`,
  },
  {
    label: '支付',
    content: `模块：支付
需求：支持下单后支付宝/微信支付。
规则：支付超时自动取消；重复回调需幂等处理。`,
  },
];

const EMPTY_MAP: MindMapNode = {
  data: { text: '@测试用例', uid: 'root', id: 'root' },
  children: [],
};

const CHAT_BUBBLE_SIZE = 44;
const CHAT_BUBBLE_PANEL_WIDTH = 420;
const CHAT_BUBBLE_PANEL_HEIGHT = 620;
const CHAT_BUBBLE_MARGIN = 12;
const CHAT_BUBBLE_TOP = 82;
const CHAT_BUBBLE_DRAG_THRESHOLD = 6;
const PRECONDITION_TAG = '前置';

type ChatBubblePosition = {
  x: number;
  y: number;
};

type ChatBubbleDragState = ChatBubblePosition & {
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  width: number;
  height: number;
  moved: boolean;
};

function normalizeMindMap(input: unknown): MindMapNode {
  const node = input as {
    data?: { text?: unknown; uid?: unknown; id?: unknown; tag?: unknown; priority?: unknown };
    children?: unknown;
  };
  const text = typeof node?.data?.text === 'string' && node.data.text.trim() ? node.data.text : '未命名节点';
  const childrenRaw = Array.isArray(node?.children) ? node.children : [];
  const rawTags = Array.isArray(node?.data?.tag) ? node.data.tag.map(String).filter(Boolean) : [];
  const priority =
    typeof node?.data?.priority === 'string' && /^P[0-3]$/i.test(node.data.priority)
      ? (node.data.priority.toUpperCase() as 'P0' | 'P1' | 'P2' | 'P3')
      : (rawTags.find((tag) => /^P[0-3]$/i.test(tag))?.toUpperCase() as 'P0' | 'P1' | 'P2' | 'P3' | undefined) ||
        extractPriorityFromText(text);
  const hasPreconditionTag = rawTags.includes(PRECONDITION_TAG) || text.trim().startsWith('!');
  const businessTags = rawTags.filter((tag) => !/^P[0-3]$/i.test(tag) && tag !== PRECONDITION_TAG);
  const tag = [
    ...(priority ? [priority] : []),
    ...(hasPreconditionTag ? [PRECONDITION_TAG] : []),
    ...businessTags,
  ];

  return {
    data: {
      text: cleanPreconditionPrefix(priority ? cleanPriorityPrefix(text) || text : text) || text,
      ...(typeof node?.data?.uid === 'string' ? { uid: node.data.uid } : {}),
      ...(typeof node?.data?.id === 'string' ? { id: node.data.id } : {}),
      ...(priority ? { priority } : {}),
      ...(tag.length > 0 ? { tag } : {}),
    },
    children: childrenRaw.map((child) => normalizeMindMap(child)),
  };
}

function countMindMap(root: MindMapNode) {
  const stats = {
    categories: 0,
    preconditions: 0,
    caseCount: 0,
    priorities: { P0: 0, P1: 0, P2: 0, P3: 0 },
  };

  const categoryNodes = root.data.text.startsWith('@') ? root.children : [root];
  stats.categories = categoryNodes.length;

  for (const categoryNode of categoryNodes) {
    for (const preconditionNode of categoryNode.children) {
      stats.preconditions += 1;
      for (const testNode of preconditionNode.children) {
        stats.caseCount += 1;
        const priority = testNode.data.priority || extractPriorityFromText(testNode.data.text);
        if (priority) {
          stats.priorities[priority] += 1;
        }
      }
    }
  }

  return stats;
}

function extractPriorityFromText(text: string) {
  const match = text.match(/^\s*\[?\s*(P[0-3])\s*\]?\s*[-:：]?/i);
  return match ? (match[1].toUpperCase() as 'P0' | 'P1' | 'P2' | 'P3') : null;
}

function cleanPriorityPrefix(text: string) {
  return text.replace(/^\s*\[?\s*P[0-3]\s*\]?\s*[-:：]?\s*/i, '').trim();
}

function cleanPreconditionPrefix(text: string) {
  return text.replace(/^\s*!\s*/, '').trim();
}

function normalizeModuleTitle(text: string) {
  return (text || '').replace(/^@/, '').trim().toLowerCase();
}

function sameModuleNode(left: MindMapNode, right: MindMapNode) {
  const leftId = left.data.uid || left.data.id;
  const rightId = right.data.uid || right.data.id;
  if (leftId && rightId && leftId === rightId) return true;
  return normalizeModuleTitle(left.data.text) === normalizeModuleTitle(right.data.text);
}

function mergeModuleMindMap(root: MindMapNode, moduleMindMap: MindMapNode) {
  const normalizedRoot = normalizeMindMap(root);
  const normalizedModule = normalizeMindMap(moduleMindMap);
  let replaced = false;

  const children = normalizedRoot.children.map((child) => {
    if (sameModuleNode(child, normalizedModule)) {
      replaced = true;
      return normalizedModule;
    }
    return child;
  });

  return {
    ...normalizedRoot,
    children: replaced ? children : [...children, normalizedModule],
  };
}

export default function Page() {
  const mindMapRef = useRef<MindMapViewHandle | null>(null);
  const editorPanelRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<ChatBubbleDragState | null>(null);
  const hasPlacedBubbleRef = useRef(false);
  const suppressBubbleClickRef = useRef(false);
  const [mindMap, setMindMap] = useState<MindMapNode>(EMPTY_MAP);
  const [testCases, setTestCases] = useState<TestCaseItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingChat, setLoadingChat] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [loadingExportXmind, setLoadingExportXmind] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scalePercent, setScalePercent] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [chatBubblePosition, setChatBubblePosition] = useState<ChatBubblePosition>({ x: 0, y: CHAT_BUBBLE_TOP });

  const hasMindMap = mindMap.children.length > 0;
  const isInitialState = !hasMindMap;
  const canSend = !loadingChat && input.trim().length > 0;
  const mindMapStats = useMemo(() => countMindMap(mindMap), [mindMap]);
  const hasCases = mindMapStats.caseCount > 0;

  const messageList = useMemo(() => messages, [messages]);

  const getBubbleDimensions = useCallback((open: boolean) => {
    const container = editorPanelRef.current;
    if (!open) {
      return { width: CHAT_BUBBLE_SIZE, height: CHAT_BUBBLE_SIZE };
    }

    const maxWidth = container ? Math.max(CHAT_BUBBLE_SIZE, container.clientWidth - CHAT_BUBBLE_MARGIN * 2) : CHAT_BUBBLE_PANEL_WIDTH;
    const maxHeight = container ? Math.max(260, container.clientHeight - CHAT_BUBBLE_MARGIN * 2) : CHAT_BUBBLE_PANEL_HEIGHT;

    return {
      width: Math.min(CHAT_BUBBLE_PANEL_WIDTH, maxWidth),
      height: Math.min(CHAT_BUBBLE_PANEL_HEIGHT, maxHeight),
    };
  }, []);

  const clampBubblePosition = useCallback((nextPosition: ChatBubblePosition, panelWidth = CHAT_BUBBLE_SIZE, panelHeight = CHAT_BUBBLE_SIZE) => {
    const container = editorPanelRef.current;
    if (!container) return nextPosition;

    const maxX = Math.max(CHAT_BUBBLE_MARGIN, container.clientWidth - panelWidth - CHAT_BUBBLE_MARGIN);
    const maxY = Math.max(CHAT_BUBBLE_MARGIN, container.clientHeight - panelHeight - CHAT_BUBBLE_MARGIN);

    return {
      x: Math.min(Math.max(CHAT_BUBBLE_MARGIN, nextPosition.x), maxX),
      y: Math.min(Math.max(CHAT_BUBBLE_MARGIN, nextPosition.y), maxY),
    };
  }, []);

  const getDefaultBubblePosition = useCallback((open: boolean) => {
    const container = editorPanelRef.current;
    const { width, height } = getBubbleDimensions(open);

    if (!container) {
      return { x: 20, y: CHAT_BUBBLE_TOP };
    }

    return clampBubblePosition(
      {
        x: container.clientWidth - width - 20,
        y: CHAT_BUBBLE_TOP,
      },
      width,
      height,
    );
  }, [clampBubblePosition, getBubbleDimensions]);

  const updateBubblePosition = useCallback((clientX: number, clientY: number) => {
    const dragState = dragStateRef.current;
    const container = editorPanelRef.current;
    if (!dragState || !container) return;

    const containerRect = container.getBoundingClientRect();
    const nextPosition = clampBubblePosition(
      {
        x: clientX - containerRect.left - dragState.offsetX,
        y: clientY - containerRect.top - dragState.offsetY,
      },
      dragState.width,
      dragState.height,
    );

    if (!dragState.moved) {
      const deltaX = clientX - dragState.startX;
      const deltaY = clientY - dragState.startY;
      if (Math.hypot(deltaX, deltaY) >= CHAT_BUBBLE_DRAG_THRESHOLD) {
        dragState.moved = true;
        suppressBubbleClickRef.current = true;
      }
    }

    setChatBubblePosition(nextPosition);
  }, [clampBubblePosition]);

  const handleWindowMouseMove = useCallback((event: MouseEvent) => {
    updateBubblePosition(event.clientX, event.clientY);
  }, [updateBubblePosition]);

  const stopDraggingBubble = useCallback(() => {
    dragStateRef.current = null;
    window.removeEventListener('mousemove', handleWindowMouseMove);
    window.removeEventListener('mouseup', stopDraggingBubble);
  }, [handleWindowMouseMove]);

  const startDraggingBubble = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();

    dragStateRef.current = {
      x: chatBubblePosition.x,
      y: chatBubblePosition.y,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
      moved: false,
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', stopDraggingBubble);
  }, [chatBubblePosition.x, chatBubblePosition.y, handleWindowMouseMove, stopDraggingBubble]);

  const handleBubbleTriggerClick = useCallback(() => {
    if (suppressBubbleClickRef.current) {
      suppressBubbleClickRef.current = false;
      return;
    }

    setIsChatOpen(true);
  }, []);

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === editorPanelRef.current);
      requestAnimationFrame(() => mindMapRef.current?.fit());
    };

    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [loadingChat, messageList.length]);

  useEffect(() => {
    const container = editorPanelRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const syncBubblePosition = () => {
      const { width, height } = getBubbleDimensions(isChatOpen);

      if (!hasPlacedBubbleRef.current) {
        hasPlacedBubbleRef.current = true;
        setChatBubblePosition(getDefaultBubblePosition(isChatOpen));
        return;
      }

      setChatBubblePosition((prev) => clampBubblePosition(prev, width, height));
    };

    syncBubblePosition();
    const observer = new ResizeObserver(syncBubblePosition);
    observer.observe(container);

    return () => observer.disconnect();
  }, [clampBubblePosition, getBubbleDimensions, getDefaultBubblePosition, isChatOpen]);

  useEffect(() => {
    if (!hasPlacedBubbleRef.current) return;
    const { width, height } = getBubbleDimensions(isChatOpen);
    setChatBubblePosition((prev) => clampBubblePosition(prev, width, height));
    requestAnimationFrame(() => mindMapRef.current?.fit());
  }, [clampBubblePosition, getBubbleDimensions, isChatOpen]);

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', stopDraggingBubble);
    };
  }, [handleWindowMouseMove, stopDraggingBubble]);

  function extractPriority(text: string) {
    const match = text.match(/^\s*\[?\s*(P[0-3])\s*\]?\s*[-:：]?/i);
    return match ? match[1].toUpperCase() : '';
  }

  function cleanName(text: string) {
    return cleanPriorityPrefix(text);
  }

  function extractLabeledContent(text: string, label: '测试步骤' | '期望结果') {
    const normalized = (text || '').replace(/\r/g, '');
    const lines = normalized.split('\n');
    if (lines.length === 0) return '';

    const firstLine = lines[0].trim();
    const regex = new RegExp(`^${label}(\\s*\\d+)?\\s*[:：-]?\\s*(.*)$`);
    const match = firstLine.match(regex);
    if (!match) return normalized.trim();

    const inline = (match[2] || '').trim();
    const rest = lines.slice(1).join('\n').trim();
    if (inline && rest) return `${inline}\n${rest}`;
    return inline || rest;
  }

  function parseStepAndExpected(testNode: MindMapNode) {
    const stepsList: string[] = [];
    const expectedList: string[] = [];

    for (const child of testNode.children) {
      const childText = child.data.text || '';

      if (childText.includes('测试步骤')) {
        stepsList.push(extractLabeledContent(childText, '测试步骤'));
        const nestedExpected = child.children.find((c) => c.data.text.includes('期望结果'));
        if (nestedExpected) {
          expectedList.push(extractLabeledContent(nestedExpected.data.text, '期望结果'));
        }
      }

      if (childText.includes('期望结果') && expectedList.length === 0) {
        expectedList.push(extractLabeledContent(childText, '期望结果'));
      }
    }

    return {
      steps: stepsList.join('\n'),
      expected: expectedList.join('\n'),
    };
  }

  function extractCasesFromMindMap(root: MindMapNode) {
    const rows: Array<{ testName: string; priority: string; precondition: string; steps: string; expected: string }> = [];
    const level1 = root.data.text.startsWith('@') ? root.children : [root];

    for (const categoryNode of level1) {
      const category = categoryNode.data.text.replace(/^@/, '').trim() || '未分类';
      for (const preconditionNode of categoryNode.children) {
        const precondition = cleanPreconditionPrefix(preconditionNode.data.text) || '无';
        for (const testNode of preconditionNode.children) {
          const detail = parseStepAndExpected(testNode);
          rows.push({
            testName: `${category}-${cleanName(testNode.data.text)}`,
            priority: testNode.data.priority || extractPriority(testNode.data.text),
            precondition,
            steps: detail.steps,
            expected: detail.expected,
          });
        }
      }
    }

    return rows;
  }

  function exportCsv() {
    const escapeCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const header = ['测试名称', '优先级', '前置条件', '测试步骤', '期望结果'];
    const rows = extractCasesFromMindMap(mindMap);

    if (rows.length === 0) {
      setError('当前脑图里还没有可导出的测试用例');
      return;
    }

    const body = rows.map((r) =>
      [r.testName, r.priority, r.precondition, r.steps, r.expected].map((v) => escapeCell(v || '')).join(','),
    );

    const csv = [header.join(','), ...body].join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test-cases-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportXmind() {
    if (!hasCases) {
      setError('当前脑图里还没有可导出的测试用例');
      return;
    }

    setLoadingExportXmind(true);
    setError(null);
    try {
      const res = await fetch('/api/test-case-agent/export-xmind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mindMap,
          testCases,
          title: mindMap.data.text || '测试用例',
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error || '导出 XMind 失败');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${mindMap.data.text || '测试用例'}.xmind`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出 XMind 失败');
    } finally {
      setLoadingExportXmind(false);
    }
  }

  function insertTemplate(content: string) {
    setInput((prev) => (prev.trim() ? `${prev}\n${content}` : content));
  }

  function handleMindMapChange(nextMindMap: MindMapNode) {
    setMindMap(normalizeMindMap(nextMindMap));
    setTestCases([]);
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

  async function initMindMap(requirementText: string) {
    setError(null);
    try {
      setLoadingMessage('正在拆解一级模块...');
      const planRes = await fetch('/api/test-case-agent/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement: requirementText }),
      });
      const planData = await planRes.json();
      if (!planRes.ok) {
        throw new Error(planData?.error || '模块规划失败');
      }

      const modules = Array.isArray(planData.modules) ? (planData.modules as TestCaseModulePlan[]) : [];
      let currentMindMap = normalizeMindMap(planData.mindMap);
      const nextCases: TestCaseItem[] = [];
      setMindMap(currentMindMap);
      setTestCases([]);

      for (const [index, module] of modules.entries()) {
        setLoadingMessage(`正在生成 ${module.title}（${index + 1}/${modules.length}）...`);
        const moduleRes = await fetch('/api/test-case-agent/module', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requirement: requirementText, module, modules }),
        });
        const moduleData = await moduleRes.json();
        if (!moduleRes.ok) {
          throw new Error(moduleData?.error || `${module.title} 生成失败`);
        }

        const moduleMindMap = normalizeMindMap(moduleData.mindMap);
        currentMindMap = mergeModuleMindMap(currentMindMap, moduleMindMap);
        if (Array.isArray(moduleData.cases)) {
          nextCases.push(...(moduleData.cases as TestCaseItem[]));
        }
        setMindMap(currentMindMap);
        setTestCases([...nextCases]);
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `${planData.summary}\n\n已按 ${modules.length} 个模块分步生成 ${nextCases.length} 条用例，可继续修改。`,
        },
      ]);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
      return false;
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (loadingChat || !text) return;

    const userMessage: ChatMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoadingChat(true);
    setError(null);

    try {
      if (!hasMindMap) {
        const generated = await initMindMap(text);
        if (!generated) {
          setMessages((prev) => [...prev, { role: 'assistant', content: '生成失败，请检查配置或稍后重试。' }]);
        }
        return;
      }

      const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];

      const res = await fetch('/api/test-case-agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages,
          currentMindMap: mindMap,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || '对话失败');
      }

      setMindMap(normalizeMindMap(data.mindMap));
      setTestCases([]);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.assistantReply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
      setMessages((prev) => [...prev, { role: 'assistant', content: '处理失败，请重试。' }]);
    } finally {
      setLoadingMessage('');
      setLoadingChat(false);
    }
  }

  const bubbleDimensions = getBubbleDimensions(isChatOpen);

  return (
    <main className="h-screen overflow-x-hidden bg-slate-100 p-1.5 sm:p-2">
      <Card ref={editorPanelRef} className="relative flex h-full min-w-0 flex-col overflow-hidden bg-white">
        <CardHeader className="border-b px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base">测试用例脑图</CardTitle>
              <CardDescription className="mt-1">
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
        <CardContent className="min-h-0 min-w-0 flex-1 p-2">
          <MindMapView
            ref={mindMapRef}
            data={mindMap}
            onChange={handleMindMapChange}
            onScaleChange={setScalePercent}
          />
        </CardContent>

        {isChatOpen ? (
          <div
            className="absolute z-30 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 shadow-2xl backdrop-blur"
            style={{
              left: chatBubblePosition.x,
              top: chatBubblePosition.y,
              width: bubbleDimensions.width,
              height: bubbleDimensions.height,
            }}
          >
            <div
              className="flex cursor-move select-none items-center justify-between gap-3 border-b bg-slate-50/95 px-3 py-2.5"
              onMouseDown={startDraggingBubble}
            >
              <div className="flex min-w-0 items-center gap-2">
                <MessageSquare className="h-4 w-4 text-slate-700" />
                <span className="truncate text-sm font-semibold text-slate-900">AI 对话</span>
                <span className="shrink-0 rounded-md border bg-white px-2 py-0.5 text-xs text-slate-500">
                  {loadingChat ? '处理中' : hasCases ? '可编辑' : '待生成'}
                </span>
              </div>
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-white text-slate-500 hover:bg-slate-100"
                title="收起对话"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => setIsChatOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-slate-50 px-3 py-3">
                <div className="flex flex-col gap-3">
                  {messageList.length === 0 ? (
                    <div className="rounded-lg border border-dashed bg-white p-3 text-sm leading-6 text-slate-500">
                      先输入需求并发送，AI 会生成第一版测试用例脑图；生成后可以继续通过对话局部修改。
                    </div>
                  ) : (
                    messageList.map((msg, idx) => (
                      <div
                        key={`${msg.role}-${idx}`}
                        className={`flex min-w-0 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={
                            msg.role === 'user'
                              ? 'max-w-[88%] rounded-lg rounded-br-sm bg-blue-600 px-3 py-2 text-white shadow-sm'
                              : 'max-w-[88%] rounded-lg rounded-bl-sm border border-slate-200 bg-white px-3 py-2 text-slate-800 shadow-sm'
                          }
                        >
                          <p
                            className={
                              msg.role === 'user'
                                ? 'mb-1 text-[11px] text-blue-100'
                                : 'mb-1 text-[11px] text-slate-500'
                            }
                          >
                            {msg.role === 'user' ? '你' : 'AI'}
                          </p>
                          <p className="whitespace-pre-wrap break-words text-sm leading-6">{msg.content}</p>
                        </div>
                      </div>
                    ))
                  )}
                  {loadingChat ? (
                    <div className="flex justify-start">
                      <div className="max-w-[88%] rounded-lg rounded-bl-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-sm">
                        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                        {loadingMessage || (isInitialState ? '正在分析需求、生成测试用例...' : '正在按你的指令更新脑图...')}
                      </div>
                    </div>
                  ) : null}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              <div className="min-w-0 border-t bg-white p-2.5">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  className="min-h-[78px] resize-none text-sm"
                  placeholder={
                    isInitialState
                      ? '输入需求内容，按 Enter 发送；Shift+Enter 换行'
                      : '输入修改指令，例如：删除某分支，新增 3 条边界用例'
                  }
                />
                {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1">
                    {REQUIREMENT_TEMPLATES.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        className="shrink-0 rounded-md border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        onClick={() => insertTemplate(item.content)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
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
          </div>
        ) : (
          <button
            type="button"
            className="absolute z-30 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-900/10 bg-slate-900 text-white shadow-2xl hover:bg-slate-800"
            style={{ left: chatBubblePosition.x, top: chatBubblePosition.y }}
            title="展开 AI 对话"
            onMouseDown={startDraggingBubble}
            onClick={handleBubbleTriggerClick}
          >
            <MessageSquare className="h-5 w-5" />
          </button>
        )}
      </Card>
    </main>
  );
}
