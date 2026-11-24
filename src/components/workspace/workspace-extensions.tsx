'use client';

import { useId, useRef, useState, type ChangeEvent } from 'react';
import { Blocks, BookOpen, FileUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  maxArchiveBytes, maxImportedSkills, maxSkillContext, maxSkillFileBytes, skillContextSize,
  type ExtensionCatalog, type Extensions, type TextSkill,
} from '@/lib/agent/extensionContracts';

export function WorkspaceExtensions({ value, onChange, disabled }: {
  value: Extensions;
  onChange: (value: Extensions) => void;
  disabled: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const title = useId();
  const [catalog, setCatalog] = useState<ExtensionCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState('');
  const [importError, setImportError] = useState('');
  const imported = value.importedSkills ?? [];
  const installed = value.installedSkillIds ?? [];
  const activeCount = imported.length + installed.length;

  async function refresh() {
    setCatalog(null);
    setCatalogError('');
    try {
      const response = await fetch('/api/test-case-agent/extensions', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error();
      setCatalog(await response.json() as ExtensionCatalog);
    } catch {
      setCatalogError('无法读取扩展列表。请刷新重试。');
    }
  }

  function open() {
    dialog.current?.showModal();
    void refresh();
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || importing) return;
    const markdown = /\.md$/i.test(file.name);
    setImportError('');
    setStatus('');
    if (file.size > (markdown ? maxSkillFileBytes : maxArchiveBytes)) {
      setImportError(markdown ? 'Markdown 文件不能超过 64 KB。' : 'Skill 压缩包不能超过 8 MB。');
      return;
    }
    setImporting(true);
    try {
      const response = await fetch('/api/test-case-agent/extensions', {
        method: 'POST', headers: { 'Content-Type': markdown ? 'text/markdown' : 'application/zip' }, body: file, signal: AbortSignal.timeout(30_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '导入失败');
      const known = new Set(imported.map(({ id }) => id));
      const additions = (data.skills as TextSkill[]).filter(({ id }) => {
        if (known.has(id)) return false;
        known.add(id);
        return true;
      });
      const next = [...imported, ...additions];
      if (next.length + installed.length > maxImportedSkills || skillContextSize(next) > maxSkillContext) {
        throw new Error('请先移除部分已加载的 Skill。每个会话最多启用 8 个，导入文本总计最多 40,000 字符。');
      }
      onChange({ ...value, importedSkills: next });
      setStatus(additions.length ? (markdown ? '已加载 ' : '已解压并加载 ') + additions.length + ' 个 Skill' : '这份 Skill 已经加载。');
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '导入失败');
    } finally {
      setImporting(false);
    }
  }

  function toggleMcp(id: string, checked: boolean) {
    const current = value.mcpIds ?? catalog?.mcp.map((server) => server.id) ?? [];
    onChange({ ...value, mcpIds: checked ? [...new Set([...current, id])] : current.filter((item) => item !== id) });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="mr-auto gap-1.5" onClick={open} disabled={disabled}>
        <Blocks aria-hidden="true" className="h-4 w-4" />
        MCP 与 Skill
        {activeCount ? <span className="text-xs text-primary">{activeCount} 个 Skill</span> : null}
      </Button>
      <dialog ref={dialog} aria-labelledby={title} onCancel={(event) => { if (importing) event.preventDefault(); }}
        className="m-auto max-h-[88dvh] w-[calc(100%-2rem)] max-w-lg overscroll-contain overflow-auto rounded-2xl border border-[#dce8e7] bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/35">
        <div className="space-y-5 p-5">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h1 id={title} className="text-lg font-semibold">MCP 与 Skill</h1>
              <p className="mt-1 text-sm text-slate-600">所选扩展用于当前页面的生成和对话修改。</p>
            </div>
            <button type="button" aria-label="关闭扩展" disabled={importing} onClick={() => dialog.current?.close()}
              className="rounded-md p-1.5 text-slate-600 hover:bg-muted disabled:opacity-50">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>

          <fieldset disabled={importing} className="space-y-2 rounded-xl border border-[#dce8e7] px-3 py-2.5">
            <legend className="px-1 text-sm font-semibold">资料读取 · MCP</legend>
            <p className="text-xs text-slate-600">粘贴资料链接时，从已选的服务匹配可用来源。</p>
            {catalogError ? <p role="alert" className="text-xs text-red-700">{catalogError}</p> : !catalog ? (
              <p role="status" className="text-xs text-slate-500">正在读取扩展列表…</p>
            ) : catalog.mcp.length > 0 ? (
              <>
                {catalog.mcp.map(({ id, name }) => (
                  <label key={id} className="flex min-w-0 items-center gap-2 rounded-md bg-[#f5faf8] px-2.5 py-2 text-sm">
                    <input type="checkbox" className="accent-primary" checked={value.mcpIds?.includes(id) ?? true}
                      onChange={(event) => toggleMcp(id, event.target.checked)} />
                    <span className="break-all">{name}</span>
                  </label>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={value.mcpIds === undefined}
                    onClick={() => onChange({ ...value, mcpIds: undefined })}>恢复自动匹配</Button>
                  <Button type="button" size="sm" variant="outline" disabled={value.mcpIds?.length === 0}
                    onClick={() => onChange({ ...value, mcpIds: [] })}>停用全部</Button>
                </div>
              </>
            ) : <p className="text-xs text-slate-500">服务端暂未挂载 MCP。</p>}
          </fieldset>

          <fieldset className="space-y-2 rounded-xl border border-[#dce8e7] px-3 py-2.5">
            <legend className="px-1 text-sm font-semibold">测试规范 · Skill</legend>
            <p className="text-xs text-slate-600">选择已安装的 Skill，或导入 ZIP、.skill 和 Markdown。压缩包会自动解压并读取其中的文本资料。</p>
            {catalog?.skills.map(({ id, name }) => (
              <label key={id} className="flex min-w-0 items-center gap-2 rounded-md bg-[#f5faf8] px-2.5 py-2 text-sm">
                <input type="checkbox" className="accent-primary" checked={installed.includes(id)} disabled={importing || !installed.includes(id) && activeCount >= maxImportedSkills}
                  onChange={(event) => onChange({
                    ...value, installedSkillIds: event.target.checked ? [...installed, id] : installed.filter((item) => item !== id),
                  })} />
                <span className="break-all">{name}</span>
              </label>
            ))}
            <input type="file" ref={picker} accept=".zip,.skill,.md" className="sr-only" aria-label="选择 Skill 压缩包" tabIndex={-1} onChange={upload} />
            <Button type="button" variant="outline" size="sm" disabled={importing} onClick={() => picker.current?.click()}>
              <FileUp className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {importing ? '正在解压…' : '上传 Skill'}
            </Button>
            {status ? <p role="status" className="text-xs text-primary">{status}</p> : null}
            {importError ? <p role="alert" className="text-xs text-red-700">{importError}</p> : null}
            {imported.map((skill) => (
              <div key={skill.id} className="flex items-start justify-between gap-2 rounded-lg border border-[#e1ece9] bg-[#f8fbfa] px-2.5 py-2">
                <details className="min-w-0 flex-1">
                  <summary className="cursor-pointer text-sm font-medium break-all">
                    <BookOpen aria-hidden="true" className="mx-1 inline h-3.5 w-3.5 text-primary" />{skill.name}
                    {skill.references.length ? <span className="ml-2 text-xs font-normal text-slate-600">{skill.references.length} 份资料</span> : null}
                  </summary>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-slate-700">{skill.instructions}</pre>
                  {skill.references.length ? <ul className="mt-2 text-xs text-slate-600">
                    {skill.references.map((reference) => <li className="break-all" key={reference.path}>{reference.path}</li>)}
                  </ul> : null}
                </details>
                <button type="button" disabled={importing} className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-600 hover:bg-muted"
                  aria-label={'移除 Skill ' + skill.name} onClick={() => onChange({
                    ...value, importedSkills: imported.filter((item) => item.id !== skill.id),
                  })}>移除</button>
              </div>
            ))}
          </fieldset>
          <footer className="flex justify-end gap-2">
            {catalogError ? <Button type="button" variant="outline" size="sm" onClick={refresh}>刷新扩展列表</Button> : null}
            <Button type="button" size="sm" disabled={importing} onClick={() => dialog.current?.close()}>完成</Button>
          </footer>
        </div>
      </dialog>
    </>
  );
}
