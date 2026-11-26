import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { z } from 'zod';
import { validateCaseContent } from '../lib/agent/mindMap';
import type { TestCaseItem } from '../lib/agent/types';
import type { CaseRun, createSuiteInput, editSuiteInput, recordRunInput, startRunInput, Suite, SuiteView } from './contracts';

export class WorkspaceError extends Error {}

function parse<T>(row: { payload: string } | undefined, message?: string): T {
  if (!row) throw new WorkspaceError(message ?? '记录不存在');
  return JSON.parse(row.payload) as T;
}

function validate(item: TestCaseItem): TestCaseItem {
  try {
    return validateCaseContent(item);
  } catch {
    throw new WorkspaceError('「' + item.topic.slice(0, 100) + '」的步骤和可观察的预期结果必须逐条配对');
  }
}

export function openCaseStore(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS suites (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, suite_id TEXT NOT NULL, started_at TEXT NOT NULL, payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS suite_runs ON runs(suite_id, started_at DESC);
  `);
  const suiteRow = db.prepare('SELECT payload FROM suites WHERE id = ?');
  const latestRun = db.prepare('SELECT payload FROM runs WHERE suite_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1');
  const runRow = db.prepare('SELECT payload FROM runs WHERE suite_id = ? AND id = ?');
  const insertSuite = db.prepare('INSERT INTO suites (id, updated_at, payload) VALUES (?, ?, ?)');
  const setSuite = db.prepare('UPDATE suites SET updated_at = ?, payload = ? WHERE id = ?');
  const insertRun = db.prepare('INSERT INTO runs (id, suite_id, started_at, payload) VALUES (?, ?, ?, ?)');
  const setRun = db.prepare('UPDATE runs SET payload = ? WHERE id = ?');

  function transaction<T>(action: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function getSuite(id: string) {
    return parse<Suite>(suiteRow.get(id) as { payload: string } | undefined, '找不到这个工作区');
  }

  function getRun(suite: string, run: string) {
    return parse<CaseRun>(runRow.get(suite, run) as { payload: string } | undefined, '找不到这个工作区的执行批次');
  }

  function view(suite: Suite): SuiteView {
    const row = latestRun.get(suite.id) as { payload: string } | undefined;
    return { suite, lastRun: row ? parse<CaseRun>(row) : null };
  }

  function readAtRevision(id: string, version: number) {
    const current = getSuite(id);
    if (version !== current.revision) throw new WorkspaceError('工作区已修改，请刷新并确认新的用例版本');
    return current;
  }

  return {
    list() {
      return db.prepare('SELECT payload FROM suites ORDER BY updated_at DESC, rowid DESC LIMIT 50').all()
        .map((row) => {
          const { id, title, revision, updatedAt, cases } = parse<Suite>(row as { payload: string });
          return { id, title, revision, updatedAt, count: cases.length };
        });
    },
    open: (id: string) => view(getSuite(id)),
    create({ cases, ...details }: z.infer<typeof createSuiteInput>) {
      const suite: Suite = {
        ...details, id: randomUUID(), revision: 1, updatedAt: new Date().toISOString(),
        cases: cases.map((item) => validate({ ...item, id: randomUUID() })),
      };
      insertSuite.run(suite.id, suite.updatedAt, JSON.stringify(suite));
      return view(suite);
    },
    update(input: z.infer<typeof editSuiteInput>) {
      return transaction(() => {
        const current = readAtRevision(input.suiteId, input.revision);
        const cases = new Map(current.cases.map((item) => [item.id, item]));
        for (const change of input.changes) {
          if (change.action === 'add') {
            const item = validate({ ...change.entry, id: randomUUID() });
            cases.set(item.id, item);
            continue;
          }
          const existing = cases.get(change.caseId);
          if (!existing) throw new WorkspaceError('所选用例已不存在，请刷新工作区');
          if (change.action === 'remove') cases.delete(change.caseId);
          else cases.set(change.caseId, validate({ ...existing, ...change.entry }));
        }
        if (cases.size === 0) throw new WorkspaceError('工作区至少需包含一条用例');
        const suite: Suite = {
          ...current, ...input.details, cases: [...cases.values()],
          revision: current.revision + 1, updatedAt: new Date().toISOString(),
        };
        setSuite.run(suite.updatedAt, JSON.stringify(suite), suite.id);
        return view(suite);
      });
    },
    startRun(input: z.infer<typeof startRunInput>) {
      return transaction(() => {
        const suite = readAtRevision(input.suiteId, input.revision);
        const byId = new Map(suite.cases.map((item) => [item.id, item]));
        const selected = [...new Set(input.caseIds)].map((id) => {
          const item = byId.get(id);
          if (!item) throw new WorkspaceError('执行范围包含不存在的用例，请重新选择');
          return item;
        });
        const run: CaseRun = {
          id: randomUUID(), suiteId: suite.id, revision: suite.revision, target: input.target, context: suite.context,
          startedAt: new Date().toISOString(), cases: selected, outcomes: [],
        };
        insertRun.run(run.id, run.suiteId, run.startedAt, JSON.stringify(run));
        return { run };
      });
    },
    getRun,
    record(input: z.infer<typeof recordRunInput>) {
      return transaction(() => {
        const run = getRun(input.suiteId, input.runId);
        const scope = new Set(run.cases.map(({ id }) => id));
        const outcomes = new Map(run.outcomes.map((item) => [item.caseId, item]));
        for (const item of input.outcomes) {
          if (!scope.has(item.caseId)) throw new WorkspaceError('执行结果必须属于本批次的选中用例');
          const previous = outcomes.get(item.caseId);
          if (previous && (previous.status !== item.status || previous.evidence !== item.evidence)) {
            throw new WorkspaceError('该用例已有执行记录，复测请新建批次');
          }
          outcomes.set(item.caseId, item);
        }
        const updated = { ...run, outcomes: [...outcomes.values()] };
        setRun.run(JSON.stringify(updated), updated.id);
        return updated;
      });
    },
    close: () => db.close(),
  };
}
