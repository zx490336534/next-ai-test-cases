'use client';

import { standalone, workspaceFetch } from '@/lib/client/runtime';
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { Blocks, BookOpen, FileUp, FolderUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ExtensionCatalog, Extensions, TextSkill } from '@/lib/agent/extensionContracts';
import { importSkillSelection, mergeImportedSkills, type SkillImportFailure } from './skill-upload';

export function WorkspaceExtensions({ value, onChange, library, onLibraryChange, disabled }: {
  value: Extensions;
  onChange: (value: Extensions) => void;
  library: TextSkill[];
  onLibraryChange: (skills: TextSkill[]) => void;
  disabled: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);
  const title = useId();
  const [catalog, setCatalog] = useState<ExtensionCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [failures, setFailures] = useState<SkillImportFailure[]>([]);
  const [status, setStatus] = useState('');
  const [importError, setImportError] = useState('');
  const imported = value.importedSkills ?? [];
  const installed = value.installedSkillIds ?? [];
  const activeCount = imported.length + installed.length;
  const activeIds = new Set(imported.map(({ id }) => id));
  const mounted = catalog?.skills ?? [];

  async function refresh() {
    setCatalog(null);
    setCatalogError('');
    try {
      const response = await workspaceFetch('/api/test-case-agent/extensions', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
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

  async function upload(event: ChangeEvent<HTMLInputElement>, directory: boolean) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!files.length || importing) return;
    setImportError('');
    setFailures([]);
    setStatus('');
    setProgress(undefined);
    setImporting(true);
    try {
      const result = await importSkillSelection(files, directory, (done, total) => setProgress({ done, total }));
      const merged = mergeImportedSkills(library, imported, result.skills);
      onLibraryChange(merged.library);
      onChange({ ...value, importedSkills: merged.active });
      setFailures(result.failures);
      if (merged.addedCount) setStatus('已导入 ' + merged.addedCount + ' 个 Skill，已启用 ' + merged.addedCount + ' 个。');
      else if (result.skills.length) setStatus('所选 Skill 已经导入。');
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '导入失败');
    } finally {
      setImporting(false);
      setProgress(undefined);
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
        {standalone ? 'Skill' : 'MCP 与 Skill'}
        {activeCount ? <span className="text-xs text-primary">{activeCount} 个 Skill</span> : null}
      </Button>
      <dialog ref={dialog} aria-labelledby={title} onCancel={(event) => { if (importing) event.preventDefault(); }}
        className="m-auto max-h-[88dvh] w-[calc(100%-2rem)] max-w-lg overscroll-contain overflow-auto rounded-2xl border border-[#dce8e7] bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/35">
        <div className="space-y-5 p-5">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h1 id={title} className="text-lg font-semibold">{standalone ? 'Skill' : 'MCP 与 Skill'}</h1>
              <p className="mt-1 text-sm text-slate-600">{standalone ? '导入和解压在浏览器内完成。启用的 Skill 会随生成和修改请求发给所选模型。' : '所选扩展用于当前页面的生成和对话修改。'}</p>
            </div>
            <button type="button" aria-label={standalone ? '关闭 Skill' : '关闭扩展'} disabled={importing} onClick={() => dialog.current?.close()}
              className="rounded-md p-1.5 text-slate-600 hover:bg-muted disabled:opacity-50">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>

          {!standalone && <fieldset disabled={importing} className="space-y-2 rounded-xl border border-[#dce8e7] px-3 py-2.5">
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
          </fieldset>}

          <fieldset className="space-y-2 rounded-xl border border-[#dce8e7] px-3 py-2.5">
            <legend className="px-1 text-sm font-semibold">测试规范 · Skill</legend>
            <p className="text-xs text-slate-600">{standalone ? '导入 Skill 文件或文件夹。' : '选择已安装的 Skill，或导入文件和文件夹。'}文件夹中可混放解压后的 Skill 和 ZIP、.skill 压缩包。</p>
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" variant="outline" disabled={importing || !mounted.length && !library.length}
                onClick={() => onChange({ ...value, installedSkillIds: catalog ? mounted.map(({ id }) => id) : installed, importedSkills: library })}>全选</Button>
              <Button type="button" size="sm" variant="outline" disabled={importing || !activeCount}
                onClick={() => onChange({ ...value, installedSkillIds: [], importedSkills: [] })}>全不选</Button>
            </div>
            {mounted.map(({ id, name }) => (
              <label key={id} className="flex min-w-0 items-center gap-2 rounded-md bg-[#f5faf8] px-2.5 py-2 text-sm">
                <input type="checkbox" className="accent-primary" checked={installed.includes(id)} disabled={importing}
                  onChange={(event) => onChange({
                    ...value, installedSkillIds: event.target.checked ? [...installed, id] : installed.filter((item) => item !== id),
                  })} />
                <span className="break-all">{name}</span>
              </label>
            ))}
            <input type="file" ref={picker} accept=".zip,.skill,.md" multiple className="sr-only"
              aria-label="选择 Skill 文件" tabIndex={-1} onChange={(event) => { void upload(event, false); }} />
            <input type="file" ref={folderPicker} {...{ webkitdirectory: '' }} className="sr-only"
              aria-label="选择 Skill 文件夹" tabIndex={-1} onChange={(event) => { void upload(event, true); }} />
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" variant="outline" size="sm" disabled={importing} onClick={() => picker.current?.click()}>
                <FileUp className="mr-1.5 h-4 w-4" aria-hidden="true" />上传文件
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={importing} onClick={() => folderPicker.current?.click()}>
                <FolderUp className="mr-1.5 h-4 w-4" aria-hidden="true" />选择文件夹
              </Button>
            </div>
            {importing ? <p role="status" className="text-xs text-slate-600">
              {progress ? '正在导入 ' + progress.done + ' / ' + progress.total + ' 项…' : '正在识别 Skill…'}
            </p> : null}
            {status ? <p role="status" className="text-xs text-primary">{status}</p> : null}
            {importError ? <p role="alert" className="text-xs text-red-700">{importError}</p> : null}
            {failures.length ? <details className="text-xs text-amber-900">
              <summary className="cursor-pointer">{failures.length} 项未导入</summary>
              <ul className="mt-1 max-h-36 space-y-1 overflow-auto pl-3">
                {failures.map(({ label, reason }, index) => <li key={label + index} className="break-all">{label} · {reason}</li>)}
              </ul>
            </details> : null}
            {library.length ? <p className="text-xs text-slate-600">已导入 {library.length} 个，已启用 {imported.length} 个导入 Skill。</p> : null}
            {library.map((skill) => {
              const enabled = activeIds.has(skill.id);
              return (
                <div key={skill.id} className="flex items-start justify-between gap-2 rounded-lg border border-[#e1ece9] bg-[#f8fbfa] px-2.5 py-2">
                  <input type="checkbox" className="mt-1 shrink-0 accent-primary" checked={enabled}
                    aria-label={'启用 ' + skill.name} disabled={importing}
                    onChange={(event) => onChange({
                      ...value, importedSkills: event.target.checked ? [...imported, skill] : imported.filter((item) => item.id !== skill.id),
                    })} />
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
                    aria-label={'移除 Skill ' + skill.name} onClick={() => {
                      onLibraryChange(library.filter((item) => item.id !== skill.id));
                      onChange({ ...value, importedSkills: imported.filter((item) => item.id !== skill.id) });
                    }}>移除</button>
                </div>
              );
            })}
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
