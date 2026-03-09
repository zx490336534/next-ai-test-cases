'use client';

import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Download, FileArchive, Loader2, Send, Upload } from 'lucide-react';
import { MindMapView } from '@/components/mindmap/mindmap-view';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { ChatMessage, MindMapNode, TestCaseItem } from '@/lib/agent/types';

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
  data: { text: '测试用例' },
  children: [],
};

function normalizeMindMap(input: unknown): MindMapNode {
  const node = input as { data?: { text?: unknown }; children?: unknown };
  const text = typeof node?.data?.text === 'string' && node.data.text.trim() ? node.data.text : '未命名节点';
  const childrenRaw = Array.isArray(node?.children) ? node.children : [];
  return {
    data: { text },
    children: childrenRaw.map((child) => normalizeMindMap(child)),
  };
}

export default function Page() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mindMap, setMindMap] = useState<MindMapNode>(EMPTY_MAP);
  const [testCases, setTestCases] = useState<TestCaseItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingChat, setLoadingChat] = useState(false);
  const [loadingImport, setLoadingImport] = useState(false);
  const [loadingExportXmind, setLoadingExportXmind] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isInitialState = messages.length === 0 && mindMap.children.length === 0;
  const canSend = !loadingChat && input.trim().length > 0;

  const messageList = useMemo(() => messages, [messages]);

  function extractPriority(text: string) {
    const match = text.match(/\b(P[0-3])\b/i);
    return match ? match[1].toUpperCase() : '';
  }

  function cleanName(text: string) {
    return text.replace(/^\s*\[?P[0-3]\]?\s*[-:：]?\s*/i, '').trim();
  }

  function extractCasesFromMindMap(root: MindMapNode) {
    const rows: Array<{ testName: string; priority: string; precondition: string; steps: string; expected: string }> = [];
    const level1 = root.data.text.startsWith('@') ? root.children : [root];

    for (const categoryNode of level1) {
      const category = categoryNode.data.text.replace(/^@/, '').trim() || '未分类';
      for (const preconditionNode of categoryNode.children) {
        const precondition = preconditionNode.data.text.replace(/^!/, '').trim() || '无';
        for (const testNode of preconditionNode.children) {
          rows.push({
            testName: `${category}-${cleanName(testNode.data.text)}`,
            priority: extractPriority(testNode.data.text),
            precondition,
            steps: '',
            expected: '',
          });
        }
      }
    }

    return rows;
  }

  function exportCsv() {
    const escapeCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const header = ['测试名称', '优先级', '前置条件', '测试步骤', '期望结果'];
    const rows =
      testCases.length > 0
        ? testCases.map((c) => ({
            testName: `${c.category}-${c.topic}`,
            priority: c.priority,
            precondition: c.precondition,
            steps: c.steps,
            expected: c.expected,
          }))
        : extractCasesFromMindMap(mindMap);
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

  async function onImportXmind(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoadingImport(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/test-case-agent/import-xmind', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || '导入失败');
      }
      setMindMap(normalizeMindMap(data.mindMap));
      setTestCases([]);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.summary || `已导入 ${file.name}` }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setLoadingImport(false);
      e.target.value = '';
    }
  }

  function insertTemplate(content: string) {
    setInput((prev) => (prev.trim() ? `${prev}\n${content}` : content));
  }

  async function initMindMap(requirementText: string) {
    setError(null);
    try {
      const res = await fetch('/api/test-case-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement: requirementText }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || '初始化失败');
      }

      setMindMap(normalizeMindMap(data.mindMap));
      setTestCases(Array.isArray(data.cases) ? data.cases : []);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `${data.summary}\n\n脑图已生成，可继续修改。`,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
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
      if (isInitialState) {
        await initMindMap(text);
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
      setLoadingChat(false);
    }
  }

  return (
    <main className="h-screen overflow-x-hidden bg-slate-100 p-2">
      <div className="grid h-full w-full grid-cols-1 gap-2 lg:grid-cols-[1.25fr_0.75fr] lg:gap-3">
        <Card className="h-full min-w-0 overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>脑图</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={exportCsv}>
                  <Download className="mr-2 h-4 w-4" />
                  导出 CSV
                </Button>
                <Button variant="outline" size="sm" onClick={exportXmind} disabled={loadingExportXmind}>
                  {loadingExportXmind ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileArchive className="mr-2 h-4 w-4" />
                  )}
                  导出 XMind
                </Button>
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={loadingImport}>
                  {loadingImport ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  导入 XMind
                </Button>
                <input ref={fileInputRef} type="file" accept=".xmind" className="hidden" onChange={onImportXmind} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="h-[calc(100%-88px)] min-w-0">
            <MindMapView data={mindMap} />
          </CardContent>
        </Card>

        <Card className="h-full min-w-0 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle>对话</CardTitle>
            <CardDescription>点击发送生成或修改脑图</CardDescription>
          </CardHeader>
          <CardContent className="flex h-[calc(100%-88px)] min-w-0 flex-col gap-3">
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg border bg-white p-3">
              <div className="space-y-3">
                {messageList.length === 0 ? (
                  <p className="text-sm text-slate-500">先输入需求并发送，生成第一版脑图。</p>
                ) : (
                  messageList.map((msg, idx) => (
                    <div
                      key={`${msg.role}-${idx}`}
                      className={
                        msg.role === 'user'
                          ? 'ml-6 min-w-0 rounded-lg bg-blue-50 p-3'
                          : 'mr-6 min-w-0 rounded-lg bg-slate-100 p-3'
                      }
                    >
                      <p className="mb-1 text-xs text-slate-500">{msg.role === 'user' ? '你' : 'AI'}</p>
                      <p className="whitespace-pre-wrap break-words text-sm">{msg.content}</p>
                    </div>
                  ))
                )}
                {loadingChat ? (
                  <div className="mr-6 min-w-0 rounded-lg bg-slate-100 p-3 text-sm text-slate-500">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> 正在更新...
                  </div>
                ) : null}
              </div>
            </div>

            <div className="min-w-0 rounded-lg border bg-white p-3">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="min-h-[90px]"
                placeholder={
                  isInitialState
                    ? '输入需求内容，点击发送生成脑图；生成后可继续通过对话修改脑图'
                    : '输入修改指令，例如：删除某分支，新增3条边界用例'
                }
              />
              {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {REQUIREMENT_TEMPLATES.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="rounded-full border px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                    onClick={() => insertTemplate(item.content)}
                  >
                    {item.label}
                  </button>
                ))}
                <Button onClick={sendMessage} disabled={!canSend}>
                  {loadingChat ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  发送
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
