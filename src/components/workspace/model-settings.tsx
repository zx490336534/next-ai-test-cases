'use client';

import { standalone, workspaceFetch } from '@/lib/client/runtime';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ModelSettings } from '@/lib/agent/modelConfig';

const storageKey = 'next-ai-test-cases:model';

export function readSavedSettings(): ModelSettings {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return {};
    const value = JSON.parse(saved);
    if (!value || typeof value !== 'object') return {};
    return {
      model: typeof value.model === 'string' ? value.model : '',
      baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
      apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    };
  } catch {
    return {};
  }
}

export function ModelSettingsDialog({ settings, onChange }: {
  settings: ModelSettings;
  onChange: (settings: ModelSettings) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const detailId = useId();
  const [draft, setDraft] = useState<ModelSettings>({});
  const [remember, setRemember] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState('');
  const testRequest = useRef<AbortController | null>(null);
  const setField = (field: keyof ModelSettings, value: string) => {
    setStatus('');
    setDraft((previous) => ({ ...previous, [field]: value, ...(field === 'baseUrl' && { apiKey: '' }) }));
  };

  function open() {
    const saved = readSavedSettings();
    setDraft(settings);
    setRemember(Object.keys(saved).length > 0);
    setStatus('');
    dialog.current?.showModal();
  }

  function save(event: FormEvent) {
    event.preventDefault();
    const next = { model: draft.model?.trim(), baseUrl: draft.baseUrl?.trim(), apiKey: draft.apiKey?.trim() };
    try {
      if (remember) localStorage.setItem(storageKey, JSON.stringify(next));
      else localStorage.removeItem(storageKey);
    } catch {
      onChange(next);
      setStatus('已应用在当前页面。浏览器限制了持久保存，请检查站点设置。');
      return;
    }
    onChange(next);
    dialog.current?.close();
  }

  function clear() {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      setStatus('浏览器限制了站点存储访问，请通过浏览器清除此站点的数据。');
      return;
    }
    setDraft({});
    setRemember(false);
    onChange({});
    setStatus(standalone ? '已清除，请重新填写 API Key。' : '已清除，使用服务端默认设置。');
  }

  async function testConnection() {
    if (testRequest.current) return;
    const request = new AbortController();
    testRequest.current = request;
    setTesting(true);
    setStatus('正在连接模型…');
    try {
      const response = await workspaceFetch('/api/test-case-agent/model-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: draft }),
        signal: request.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? '连接失败');
      }
      if (testRequest.current === request && !request.signal.aborted) setStatus('连接成功。');
    } catch (error) {
      if (!request.signal.aborted) setStatus(error instanceof Error ? error.message : '连接失败');
    } finally {
      if (testRequest.current === request) {
        testRequest.current = null;
        setTesting(false);
      }
    }
  }

  function close() {
    testRequest.current?.abort();
    testRequest.current = null;
    setTesting(false);
    setDraft({});
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={open}>
        <Settings2 className="mr-2 h-4 w-4" aria-hidden="true" />
        模型设置
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        aria-describedby={detailId}
        onClose={close}
        className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-md overscroll-contain overflow-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/40"
      >
        <form className="space-y-4 p-5" onSubmit={save}>
          <div>
            <h1 id={titleId} className="text-lg font-semibold">模型设置</h1>
            <p id={detailId} className="mt-1 text-sm text-slate-600">{standalone ? '填写 API Key。直接打开 HTML 时，模型网关需允许跨域（CORS）。本机网关也可通过 Release 附带的启动器连接。' : '使用 OpenAI 兼容模型。留空的字段沿用服务端配置。'}</p>
          </div>
          <label className="block space-y-1 text-sm font-medium">
            <span>模型名</span>
            <Input autoFocus disabled={testing} value={draft.model ?? ''} maxLength={180} onChange={(event) => setField('model', event.target.value)} placeholder="gpt-4.1-mini" />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            <span>Base URL</span>
            <Input type="url" disabled={testing} value={draft.baseUrl ?? ''} maxLength={2048} onChange={(event) => setField('baseUrl', event.target.value)} placeholder="https://api.openai.com/v1" />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            <span>API Key</span>
            <Input type="password" disabled={testing} autoComplete="off" value={draft.apiKey ?? ''} maxLength={2048} onChange={(event) => setField('apiKey', event.target.value)} placeholder="输入所选网关的密钥" />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            在此浏览器记住设置和密钥
          </label>
          <p aria-live="polite" className="min-h-5 text-sm text-slate-700">{status}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={testing} onClick={testConnection}>测试连接</Button>
            <Button type="button" variant="outline" size="sm" disabled={testing} onClick={clear}>清除设置</Button>
            <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => dialog.current?.close()}>取消</Button>
            <Button type="submit" size="sm" disabled={testing}>保存</Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
