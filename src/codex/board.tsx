import { App } from '@modelcontextprotocol/ext-apps';
import { CheckCircle2, ClipboardList, Play, RefreshCw, Scan, Workflow, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MindMapView, type MindMapViewHandle } from '../components/mindmap/mindmap-view';
import { buildMindMap, EMPTY_MAP, stripCategory } from '../lib/agent/mindMap';
import type { TestCaseItem } from '../lib/agent/types';
import type { CaseFields, Outcome, SuiteListItem, SuiteView } from './contracts';

const app = new App({ name: '测试用例工作区', version: '0.1.2' });
const verdicts: Record<Outcome['status'], string> = { passed: '通过', failed: '失败', blocked: '阻塞', skipped: '跳过' };
const actions = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-[#d5e5df] bg-white px-3 py-1.5 text-sm font-medium text-[#174842] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#267168] disabled:opacity-45';
const fieldClass = 'w-full min-w-0 rounded-lg border border-[#cadcd6] bg-white px-3 py-2 text-base focus:outline-2 focus:outline-[#267168]';

function errorMessage(result: Awaited<ReturnType<typeof app.callServerTool>>) {
  return result.content?.find((item) => item.type === 'text')?.text ?? '操作失败';
}

function readView(data: Record<string, unknown> | undefined): SuiteView | undefined {
  const value = data as SuiteView | undefined;
  return value?.suite?.id && Array.isArray(value.suite.cases) ? value : undefined;
}

function loadSnapshot() {
  const data = document.getElementById('test-case-workbench-data')?.textContent;
  return data ? readView(JSON.parse(data)) : undefined;
}

const snapshot = loadSnapshot();

function Board() {
  const [view, setView] = useState<SuiteView | undefined>(snapshot);
  const [workspaces, setWorkspaces] = useState<SuiteListItem[]>();
  const [activeId, setActiveId] = useState('');
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const [fallback, setFallback] = useState('');
  const [target, setTarget] = useState('');
  const [editing, setEditing] = useState<{ entry: TestCaseItem; revision: number }>();
  const dialog = useRef<HTMLDialogElement>(null);
  const map = useRef<MindMapViewHandle>(null);

  useEffect(() => {
    if (snapshot) return;
    app.ontoolresult = (result) => {
      const next = readView(result.structuredContent);
      const suites = result.structuredContent?.suites;
      if (next) setView(next);
      else if (Array.isArray(suites)) {
        setWorkspaces(suites);
        setView(undefined);
      } else if (result.isError) setFailure(errorMessage(result));
    };
    void app.connect().catch(() => setFailure('无法连接 Codex。请通过聊天中的工作区工具重新打开。'));
    return () => { app.ontoolresult = undefined; };
  }, []);

  const suite = view?.suite;
  const run = view?.lastRun;
  const categories = useMemo(() => {
    const modules = new Map<string, number>();
    for (const entry of suite?.cases ?? []) {
      const name = stripCategory(entry.category);
      modules.set(name, (modules.get(name) ?? 0) + 1);
    }
    return [...modules].map(([name, count], index) => ({ name, count, id: 'overview-module-' + index }));
  }, [suite]);
  const matching = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return suite?.cases.filter((item) => (!category || stripCategory(item.category) === category)
      && (!needle || [item.topic, item.category, item.priority].some((label) => label.toLocaleLowerCase().includes(needle)))) ?? [];
  }, [suite, category, query]);
  const overview = !category && !query.trim() && (suite?.cases.length ?? 0) > 50 && categories.length > 1;
  const tree = useMemo(() => !suite ? null : overview ? {
    ...EMPTY_MAP,
    children: categories.map(({ name, count, id }) => ({ data: { text: name + '（' + count + '）', id, uid: id }, children: [] })),
  } : buildMindMap(matching, (entry) => entry.id), [suite, overview, categories, matching]);
  const active = suite?.cases.find(({ id }) => id === activeId);
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const scope = suite?.cases.map(({ id }) => id).filter((id) => selectedIds.has(id)) ?? [];
  const outcomes = useMemo(() => new Map(run?.outcomes.map((outcome) => [outcome.caseId, outcome])), [run]);

  const executionPrompt = suite && scope.length ? [
    '请使用测试用例工作区技能执行所选用例，严格按以下范围创建执行批次，并回写实际证据。',
    '工作区 ID：' + suite.id, '用例版本：' + suite.revision, '用例 ID：' + scope.join('、'),
    ...(target.trim() ? ['执行目标：' + target.trim()] : ['沿用会话中已明确的执行目标，目标未确定时请先确认。']),
  ].join('\n') : '';

  async function update(name: string, args: Record<string, unknown>) {
    setPending(true);
    setFailure('');
    setNotice('');
    try {
      const result = await app.callServerTool({ name, arguments: args }, { timeout: 12_000 });
      if (result.isError) throw new Error(errorMessage(result));
      const next = readView(result.structuredContent);
      if (!next) throw new Error('没有收到工作区数据');
      setView(next);
      setCategory('');
      setQuery('');
      return true;
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '操作失败');
      return false;
    } finally {
      setPending(false);
    }
  }

  function openEditor() {
    if (!active || !suite) return;
    setFailure('');
    setEditing({ entry: active, revision: suite.revision });
    dialog.current?.showModal();
  }

  async function save(form: HTMLFormElement) {
    if (!suite || !editing || pending || !form.reportValidity()) return;
    const data = new FormData(form);
    const entry = Object.fromEntries(data.entries()) as CaseFields;
    const changes = [{ action: 'update', caseId: editing.entry.id, entry }];
    if (await update('update_suite', { suiteId: suite.id, revision: editing.revision, changes })) {
      setNotice('已保存人工修改。');
      dialog.current?.close();
    }
  }

  async function sendSelection() {
    if (!executionPrompt || pending) return;
    if (snapshot) { setFallback(executionPrompt); return; }
    setPending(true);
    setNotice('');
    setFailure('');
    setFallback('');

    try {
      const sent = await app.sendMessage({ role: 'user', content: [{ type: 'text', text: executionPrompt }] }, { timeout: 6000 });
      if (sent.isError) throw new Error('宿主未接收消息');
      setNotice('已交给 Codex，实际结果会记录在执行批次里。');
    } catch {
      setFallback(executionPrompt);
    } finally {
      setPending(false);
    }
  }

  if (workspaces && !suite) return (
    <main className="bg-[#edf4f1] p-3 text-[#172d31] sm:p-4">
      <h1 className="text-lg font-semibold">测试用例脑图</h1>
      <p className="mt-1 text-sm text-slate-600">选择要在当前聊天查看的工作区。</p>
      {workspaces.length ? <ul className="mt-3 space-y-2">
        {workspaces.map((entry) => <li key={entry.id}>
          <button type="button" className={actions + ' w-full justify-between text-left'} disabled={pending}
            onClick={() => {
              setActiveId('');
              setSelected([]);
              setTarget('');
              setFallback('');
              void update('open_suite', { suiteId: entry.id });
            }}>
            <span className="min-w-0 break-words">{entry.title}</span>
            <span className="shrink-0 text-xs text-slate-600">{entry.count} 条用例</span>
          </button>
        </li>)}
      </ul> : <p className="mt-3 text-sm text-slate-600">暂无工作区。先在聊天中生成用例。</p>}
      {failure && <p className="mt-2 text-sm text-red-700" role="alert">{failure}</p>}
    </main>
  );

  if (!suite || !tree) return (
    <main className="p-5 text-sm text-slate-600">
      <p role={failure ? 'alert' : 'status'}>{failure || '正在读取用例工作区…'}</p>
    </main>
  );

  return (
    <main className="@container bg-[#edf4f1] p-3 text-[#172d31] sm:p-4">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-[#d5e5df] bg-white shadow-sm">
        <header className="flex flex-wrap items-center gap-3 border-b border-[#e2ece7] px-4 py-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e0f1e8] text-[#176454]"><Workflow aria-hidden="true" className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-lg font-semibold">{suite.title}</h1>
            <p className="text-xs text-slate-600">版本 {suite.revision} · {suite.cases.length} 条用例</p>
          </div>
          {workspaces && <button className={actions} type="button" disabled={pending} onClick={() => {
            setFailure('');
            setNotice('');
            setView(undefined);
          }}>切换工作区</button>}
          {snapshot ? <span className="text-xs text-slate-600">本地脑图快照</span> :
            <button className={actions} type="button" disabled={pending} onClick={() => { void update('open_suite', { suiteId: suite.id }); }}>
              <RefreshCw aria-hidden="true" className="h-4 w-4" />刷新
            </button>}
        </header>

        <div className="grid min-w-0 gap-3 p-3 @min-[720px]:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
          <section aria-label="用例脑图" className="min-w-0">
            <div className="mb-2 flex flex-wrap gap-1.5">
              <label className="min-w-40 flex-1">
                <span className="sr-only">脑图模块</span>
                <select value={category} onChange={(event) => setCategory(event.target.value)} className={fieldClass + ' min-h-10'}>
                  <option value="">全部模块</option>
                  {categories.map((module) => <option key={module.id} value={module.name}>{module.name}（{module.count}）</option>)}
                </select>
              </label>
              <button className={actions} type="button" onClick={() => map.current?.fit()}><Scan aria-hidden="true" className="h-4 w-4" />适应画布</button>
              <button className={actions} type="button" aria-label="缩小脑图" onClick={() => map.current?.zoomOut()}><ZoomOut aria-hidden="true" className="h-4 w-4" /></button>
              <button className={actions} type="button" aria-label="放大脑图" onClick={() => map.current?.zoomIn()}><ZoomIn aria-hidden="true" className="h-4 w-4" /></button>
            </div>
            <div className="h-72 @min-[720px]:h-[26rem]">
              <MindMapView key={suite.id} ref={map} data={tree} readOnly compact onNodeClick={(nodeId) => {
                if (overview) {
                  const match = categories.find(({ id }) => id === nodeId);
                  if (match) setCategory(match.name);
                  return;
                }
                const item = matching.find(({ id }) => nodeId === id || nodeId.startsWith(id + '-'));
                if (item) setActiveId(item.id);
              }} />
            </div>
            {overview && <p className="mt-1 px-1 text-xs text-slate-600">点击模块节点或使用模块选择器查看详细用例。</p>}
          </section>

          <section aria-labelledby="case-list-title" className="flex min-w-0 flex-col rounded-xl border border-[#dce9e4] bg-[#f8fbf9] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="case-list-title" className="flex items-center gap-1.5 text-sm font-semibold"><ClipboardList className="h-4 w-4" aria-hidden="true" />执行范围</h2>
              <button className={actions} type="button" onClick={() => setSelected(scope.length === suite.cases.length ? [] : suite.cases.map(({ id }) => id))}>
                {scope.length === suite.cases.length ? '清空选择' : '选择全部'}
              </button>
            </div>
            <label className="mt-2 block">
              <span className="sr-only">搜索用例</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
                className={fieldClass} placeholder="搜索标题、模块或优先级" />
            </label>
            <p role="status" className="mt-1 text-xs text-slate-600">当前显示 {matching.length} / {suite.cases.length}，已选 {scope.length}</p>
            <ul className="my-2 max-h-72 min-w-0 overflow-y-auto overscroll-contain rounded-lg border border-[#dce9e4] bg-white">
              {matching.map((item) => (
                <li key={item.id} className="flex min-w-0 items-start border-b border-[#edf2ef] last:border-b-0">
                  <label className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center">
                    <input type="checkbox" className="h-4 w-4 accent-[#176454]" aria-label={'选择 ' + item.topic}
                      checked={selectedIds.has(item.id)}
                      onChange={(event) => setSelected(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} />
                  </label>
                  <button type="button" aria-pressed={active?.id === item.id}
                    className="min-h-11 min-w-0 flex-1 break-words py-2 pr-2 text-left text-sm aria-pressed:text-[#126348] aria-pressed:underline"
                    onClick={() => { setActiveId(item.id); map.current?.locate(item.id); }}>
                    <span className="mr-1.5 rounded bg-[#e9f3ed] px-1.5 py-0.5 text-xs font-medium text-[#176454]">{item.priority}</span>{item.topic}
                  </button>
                </li>
              ))}
            </ul>
            {active && <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-[#e6f2ec] p-2">
              <span className="min-w-0 flex-1 break-words text-sm">{active.topic}</span>
              {!snapshot && <button className={actions} type="button" disabled={pending} onClick={openEditor}>编辑用例</button>}
            </div>}
            {active && <details className="mb-2 rounded-lg border border-[#dce9e4] bg-white px-2 py-1.5 text-xs">
              <summary className="cursor-pointer font-medium">用例详情</summary>
              <dl className="mt-2 space-y-1 break-words whitespace-pre-wrap">
                <dt className="font-semibold">前置条件</dt><dd>{active.precondition}</dd>
                <dt className="font-semibold">测试步骤</dt><dd>{active.steps}</dd>
                <dt className="font-semibold">预期结果</dt><dd>{active.expected}</dd>
              </dl>
            </details>}
            <label className="block text-xs font-medium text-slate-700">执行目标（可沿用聊天中的目标）
              <input className={fieldClass + ' mt-1'} maxLength={1000} value={target} onChange={(event) => setTarget(event.target.value)} placeholder="本地项目、测试环境或明确的测试对象" />
            </label>
            <button className={actions + ' mt-3 bg-[#176454]! text-white!'} type="button" disabled={!scope.length || pending} onClick={() => { void sendSelection(); }}>
              <Play className="h-4 w-4" aria-hidden="true" />{snapshot ? '生成 Codex 执行指令' : '交给 Codex 执行'}（{scope.length}）
            </button>
          </section>
        </div>

        <div className="space-y-2 px-4 pb-4 text-sm">
          {notice && <p role="status" className="text-[#176454]">{notice}</p>}
          {failure && !editing && <p role="alert" className="text-red-700">{failure}</p>}
          {fallback && fallback === executionPrompt && <label className="block text-sm text-slate-700">{snapshot ? '将下面的指令粘贴到 Codex 聊天，按此快照的工作区和版本执行所选用例。' : '当前客户端无法代发消息。把下面的指令粘贴到 Codex 聊天即可执行所选用例。'}
            <textarea className={fieldClass + ' mt-1 resize-y'} rows={5} readOnly value={fallback} onFocus={(event) => event.currentTarget.select()} />
          </label>}
          {run && <details className="rounded-lg border border-[#dce9e4] px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold">
              <CheckCircle2 aria-hidden="true" className="mr-1 inline h-4 w-4 text-[#176454]" />最近执行 · 版本 {run.revision} · 已记录 {run.outcomes.length}/{run.cases.length}
            </summary>
            <p className="mt-2 break-words text-slate-700">目标 {run.target}</p>
            <ul className="mt-2 space-y-2">
              {run.cases.map((item) => {
                const outcome = outcomes.get(item.id);
                return <li key={item.id} className="break-words border-t border-[#edf2ef] pt-2">
                  <span className="font-medium">{outcome ? verdicts[outcome.status] : '待执行'}</span> · {item.topic}
                  {outcome && <p className="mt-1 whitespace-pre-wrap text-slate-600">{outcome.evidence}</p>}
                </li>;
              })}
            </ul>
          </details>}
        </div>
      </div>

      <dialog ref={dialog} aria-labelledby="case-editor-title" onClose={() => setEditing(undefined)}
        className="m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-xl border border-[#d5e5df] bg-white p-4 shadow-xl backdrop:bg-slate-950/40">
        {editing && <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          void save(event.currentTarget);
        }} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            void save(event.currentTarget);
          }
        }}>
          <h2 id="case-editor-title" className="text-base font-semibold">编辑用例</h2>
          <label className="block text-sm">标题<input className={fieldClass} name="topic" defaultValue={editing.entry.topic} maxLength={200} required /></label>
          <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
            <label className="block text-sm">类别<input className={fieldClass} name="category" defaultValue={editing.entry.category} maxLength={120} required /></label>
            <label className="block text-sm">优先级<select className={fieldClass} name="priority" defaultValue={editing.entry.priority}>{['P0', 'P1', 'P2', 'P3'].map((value) => <option key={value}>{value}</option>)}</select></label>
          </div>
          <label className="block text-sm">前置条件<textarea className={fieldClass} name="precondition" rows={2} defaultValue={editing.entry.precondition} maxLength={2000} required /></label>
          <label className="block text-sm">测试步骤<textarea className={fieldClass} name="steps" rows={4} defaultValue={editing.entry.steps} maxLength={8000} required /></label>
          <label className="block text-sm">预期结果<textarea className={fieldClass} name="expected" rows={4} defaultValue={editing.entry.expected} maxLength={8000} required /></label>
          {failure && <p role="alert" className="text-sm text-red-700">{failure}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={actions} onClick={() => dialog.current?.close()}>取消</button>
            <button className={actions + ' bg-[#176454]! text-white!'} type="button" disabled={pending} onClick={(event) => {
              const form = event.currentTarget.form;
              if (form) void save(form);
            }}>保存修改</button>
          </div>
        </form>}
      </dialog>
    </main>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<Board />);
