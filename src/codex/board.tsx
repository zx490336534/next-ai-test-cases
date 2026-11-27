import { version as pluginVersion } from '../../plugin/codex-test-cases/plugin.json';
import './board.css';
import { App } from '@modelcontextprotocol/ext-apps';
import { CheckCircle2, ChevronRight, ClipboardList, FolderOpen, ListFilter, Pencil, Play, RefreshCw, Scan, Search, Workflow, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MindMapView, type MindMapViewHandle } from '../components/mindmap/mindmap-view';
import { buildMindMap, EMPTY_MAP, stripCategory } from '../lib/agent/mindMap';
import type { TestCaseItem } from '../lib/agent/types';
import { boardSelection } from './case-selection';
import type { CaseFields, Outcome, SuiteListItem, SuiteView } from './contracts';

const app = new App({ name: '测试用例工作区', version: pluginVersion });
const verdicts: Record<Outcome['status'], string> = { passed: '通过', failed: '失败', blocked: '阻塞', skipped: '跳过' };
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
  const [{ view, selectedIds, selectionNotice }, dispatch] = useReducer(boardSelection, {
    view: snapshot, selectedIds: new Set<string>(), selectionNotice: '',
  });
  const [workspaces, setWorkspaces] = useState<SuiteListItem[]>();
  const [activeId, setActiveId] = useState('');
  const [pane, setPane] = useState<'map' | 'cases'>('map');
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
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
      if (next) dispatch({ type: 'view', view: next });
      else if (Array.isArray(suites)) {
        setWorkspaces(suites);
        dispatch({ type: 'view' });
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
  const allMatchingSelected = matching.length > 0 && matching.every(({ id }) => selectedIds.has(id));
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
      dispatch({ type: 'view', view: next });
      if (next.suite.id !== suite?.id) {
        setCategory('');
        setQuery('');
        setPane('map');
        setTarget('');
        setFallback('');
        setActiveId('');
      } else if (category && !next.suite.cases.some((item) => stripCategory(item.category) === category)) {
        setCategory('');
      }
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

  async function chooseWorkspace() {
    setPending(true);
    setFailure('');
    setNotice('');
    try {
      const result = await app.callServerTool({ name: 'list_suites', arguments: {} }, { timeout: 12_000 });
      if (result.isError) throw new Error(errorMessage(result));
      const list = result.structuredContent?.suites;
      if (!Array.isArray(list)) throw new Error('没有收到工作区列表');
      setWorkspaces(list);
      dispatch({ type: 'view' });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '无法读取工作区列表');
    } finally {
      setPending(false);
    }
  }

  if (workspaces && !suite) return (
    <main className="cb-board cb-picker">
      <header className="cb-heading">
        <span className="cb-mark"><FolderOpen aria-hidden="true" /></span>
        <div><h1>选择工作区</h1><p>{workspaces.length} 个最近使用的工作区</p></div>
        <button type="button" className="cb-icon ml-auto" aria-label="刷新工作区列表" title="刷新工作区列表" disabled={pending} onClick={chooseWorkspace}><RefreshCw /></button>
      </header>
      {workspaces.length ? <ul className="cb-workspaces">
        {workspaces.map((entry) => <li key={entry.id}>
          <button type="button" disabled={pending} onClick={() => void update('open_suite', { suiteId: entry.id })}>
            <Workflow aria-hidden="true" />
            <span><strong>{entry.title}</strong><small>版本 {entry.revision} · {entry.count} 条用例</small></span>
            <ChevronRight aria-hidden="true" />
          </button>
        </li>)}
      </ul> : <p className="cb-empty">暂无工作区。先在聊天中生成用例。</p>}
      {failure && <p className="cb-feedback text-red-700" role="alert">{failure}</p>}
    </main>
  );

  if (!suite || !tree) return (
    <main className="cb-board cb-empty">
      <p role={failure ? 'alert' : 'status'}>{failure || '正在读取用例工作区…'}</p>
    </main>
  );

  const moduleFilter = <label className="cb-module">
    <ListFilter aria-hidden="true" /><span className="sr-only">筛选用例模块</span>
    <select value={category} onChange={(event) => setCategory(event.target.value)}>
      <option value="">全部模块</option>
      {categories.map((module) => <option key={module.id} value={module.name}>{module.name}（{module.count}）</option>)}
    </select>
  </label>;

  return (
    <main className="cb-board">
      <div className="cb-workspace" data-pane={pane}>
        <header className="cb-heading">
          <span className="cb-mark"><Workflow aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h1>{suite.title}</h1>
            <p>版本 {suite.revision} · {categories.length} 个模块 · {suite.cases.length} 条用例{snapshot && ' · 本地快照'}</p>
          </div>
          {!snapshot && <div className="cb-header-actions">
            <button className="cb-button" type="button" title="切换工作区" disabled={pending} onClick={chooseWorkspace}><FolderOpen />切换工作区</button>
            <button className="cb-icon" type="button" title="刷新工作区" aria-label="刷新工作区" disabled={pending} onClick={() => { void update('open_suite', { suiteId: suite.id }); }}><RefreshCw /></button>
          </div>}
        </header>
        <nav className="cb-panes" aria-label="工作区视图">
          <button type="button" aria-pressed={pane === 'map'} onClick={() => setPane('map')}><Workflow />用例脑图</button>
          <button type="button" aria-pressed={pane === 'cases'} onClick={() => setPane('cases')}><ClipboardList />执行范围{scope.length > 0 && <span>（{scope.length}）</span>}</button>
        </nav>
        <div className="cb-layout">
          <section aria-label="用例脑图" className="cb-map">
            <div className="cb-panel-head">
              <h2>用例脑图</h2>
              {moduleFilter}
              <div className="cb-map-tools">
                <button className="cb-icon" type="button" title="适应画布" aria-label="适应画布" onClick={() => map.current?.fit()}><Scan /></button>
                <button className="cb-icon" type="button" title="缩小脑图" aria-label="缩小脑图" onClick={() => map.current?.zoomOut()}><ZoomOut /></button>
                <button className="cb-icon" type="button" title="放大脑图" aria-label="放大脑图" onClick={() => map.current?.zoomIn()}><ZoomIn /></button>
              </div>
            </div>
            <div className="cb-canvas">
              <MindMapView key={suite.id} ref={map} data={tree} readOnly compact onNodeClick={(nodeId) => {
                if (overview) {
                  const match = categories.find(({ id }) => id === nodeId);
                  if (match) setCategory(match.name);
                  return;
                }
                const item = matching.find(({ id }) => nodeId === id || nodeId.startsWith(id + '-'));
                if (item) { setActiveId(item.id); setPane('cases'); }
              }} />
            </div>
            {overview && <p className="cb-meta mt-2">点击模块节点或使用模块选择器查看详细用例。</p>}
          </section>

          <section aria-labelledby="case-list-title" className="cb-cases">
            <div className="cb-panel-head">
              <h2 id="case-list-title">执行范围</h2>
              <div className="cb-case-filter">{moduleFilter}</div>
              <button className="cb-link ml-auto" type="button" disabled={!matching.length}
                onClick={() => dispatch({ type: 'check', cases: matching, checked: !allMatchingSelected })}>
                {allMatchingSelected ? '取消选择当前' : '选择当前'} {matching.length} 条
              </button>
            </div>
            <label className="cb-search">
              <Search aria-hidden="true" /><span className="sr-only">搜索用例</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、模块或优先级" />
            </label>
            <p role="status" className="cb-count">显示 {matching.length} / {suite.cases.length} 条<span>已选 {scope.length} 条</span></p>
            {selectionNotice && <p role="status" className="cb-meta mb-2">{selectionNotice}</p>}
            <ul className="cb-list">
              {matching.map((item) => (
                <li key={item.id} data-active={active?.id === item.id}>
                  <label>
                    <input type="checkbox" aria-label={'选择 ' + item.topic}
                      checked={selectedIds.has(item.id)}
                      onChange={(event) => dispatch({ type: 'check', cases: [item], checked: event.target.checked })} />
                  </label>
                  <button type="button" aria-pressed={active?.id === item.id}
                    className="cb-item"
                    onClick={() => { setActiveId(item.id); map.current?.locate(item.id); }}>
                    <span className="cb-priority" data-priority={item.priority}>{item.priority}</span><span>{item.topic}</span>
                  </button>
                </li>
              ))}
            </ul>
            {!matching.length && <p className="cb-empty">没有匹配的用例，请调整筛选条件。</p>}
            {active && <div className="cb-detail">
              <div className="flex items-start justify-between gap-2">
                <strong className="min-w-0 break-words">{active.topic}</strong>
                {!snapshot && <button className="cb-link shrink-0" type="button" disabled={pending} onClick={openEditor}><Pencil />编辑用例</button>}
              </div>
              <details>
                <summary>用例详情</summary>
                <dl>
                  <dt>前置条件</dt><dd>{active.precondition}</dd>
                  <dt>测试步骤</dt><dd>{active.steps}</dd>
                  <dt>预期结果</dt><dd>{active.expected}</dd>
                </dl>
              </details>
            </div>}
            <div className="cb-submit">
              <label>执行目标 <small>可沿用聊天中的目标</small>
                <input className="cb-field" maxLength={1000} value={target} onChange={(event) => setTarget(event.target.value)} placeholder="本地项目或测试环境" />
              </label>
              <button className="cb-primary mt-3 w-full" type="button" disabled={!scope.length || pending} onClick={() => { void sendSelection(); }}>
                <Play />{snapshot ? '生成 Codex 执行指令' : '交给 Codex 执行'}（{scope.length}）
              </button>
            </div>
          </section>
        </div>

        <div className="cb-feedback space-y-2">
          {notice && <p role="status" className="text-[#4540a0]">{notice}</p>}
          {failure && !editing && <p role="alert" className="text-red-700">{failure}</p>}
          {fallback && fallback === executionPrompt && <label className="block text-sm text-[#60677a]">{snapshot ? '将下面的指令粘贴到 Codex 聊天，按此快照的工作区和版本执行所选用例。' : '当前客户端无法代发消息。把下面的指令粘贴到 Codex 聊天即可执行所选用例。'}
            <textarea className="cb-field mt-1 resize-y" rows={5} readOnly value={fallback} onFocus={(event) => event.currentTarget.select()} />
          </label>}
          {run && <details className="cb-run">
            <summary className="cursor-pointer text-sm font-semibold">
              <CheckCircle2 aria-hidden="true" className="mr-1 inline h-4 w-4 text-[#4540a0]" />最近执行 · 版本 {run.revision} · 已记录 {run.outcomes.length}/{run.cases.length}
            </summary>
            <p className="mt-2 break-words text-[#60677a]">目标 {run.target}</p>
            <ul className="mt-2 space-y-2">
              {run.cases.map((item) => {
                const outcome = outcomes.get(item.id);
                return <li key={item.id} className="break-words border-t border-[#e0e2ea] pt-2">
                  <span className="font-medium">{outcome ? verdicts[outcome.status] : '待执行'}</span> · {item.topic}
                  {outcome && <p className="mt-1 whitespace-pre-wrap text-[#60677a]">{outcome.evidence}</p>}
                </li>;
              })}
            </ul>
          </details>}
        </div>
      </div>

      <dialog ref={dialog} aria-labelledby="case-editor-title" onClose={() => setEditing(undefined)}
        className="cb-dialog">
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
          <label className="block text-sm">标题<input className="cb-field" name="topic" defaultValue={editing.entry.topic} maxLength={200} required /></label>
          <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
            <label className="block text-sm">类别<input className="cb-field" name="category" defaultValue={editing.entry.category} maxLength={120} required /></label>
            <label className="block text-sm">优先级<select className="cb-field" name="priority" defaultValue={editing.entry.priority}>{['P0', 'P1', 'P2', 'P3'].map((value) => <option key={value}>{value}</option>)}</select></label>
          </div>
          <label className="block text-sm">前置条件<textarea className="cb-field" name="precondition" rows={2} defaultValue={editing.entry.precondition} maxLength={2000} required /></label>
          <label className="block text-sm">测试步骤<textarea className="cb-field" name="steps" rows={4} defaultValue={editing.entry.steps} maxLength={8000} required /></label>
          <label className="block text-sm">预期结果<textarea className="cb-field" name="expected" rows={4} defaultValue={editing.entry.expected} maxLength={8000} required /></label>
          {failure && <p role="alert" className="text-sm text-red-700">{failure}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="cb-button" onClick={() => dialog.current?.close()}>取消</button>
            <button className="cb-primary" type="button" disabled={pending} onClick={(event) => {
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
