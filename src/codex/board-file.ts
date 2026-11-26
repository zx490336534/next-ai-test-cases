import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SuiteView } from './contracts';

export function writeBoardFile(directory: string, boardHtml: string, view: SuiteView) {
  const root = boardHtml.indexOf('<div id="root"></div>');
  if (root < 0) throw new Error('脑图模板不完整');
  const json = JSON.stringify(view).replace(/</g, '\\u003c');
  const script = '<script id="test-case-workbench-data" type="application/json">' + json + '</script>\n';
  const html = boardHtml.slice(0, root) + script + boardHtml.slice(root);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, view.suite.id + '.html');
  const temporary = join(directory, '.' + randomUUID() + '.html');
  try {
    writeFileSync(temporary, html, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return path;
}
