import { workspaceFetch } from '@/lib/client/runtime';
import type { TextSkill } from '@/lib/agent/extensionContracts';
import { groupSkillPaths, isSkillManifest, pathInsideSkill } from '@/lib/agent/skillPaths';

type SkillFile = { file: File; path: string };
type Upload =
  | { kind: 'file'; file: File; label: string }
  | { kind: 'directory'; entries: SkillFile[]; label: string };

export type SkillImportFailure = { label: string; reason: string };

const packedSkill = /\.(zip|skill)$/i;

export function planFolderImport(files: File[]): Upload[] {
  const byPath = new Map<string, File>();
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const segments = path.split('/');
    if (path.includes('\\') || segments.some((part) => !part || part === '.' || part === '..')
      || segments.slice(1).some((part) => part.startsWith('.') || part === 'node_modules' || part === '__MACOSX')) continue;
    byPath.set(path, file);
  }

  const directories: Upload[] = groupSkillPaths([...byPath.keys()]).map(({ folder, manifests, references }) => ({
    kind: 'directory',
    label: folder || 'SKILL.md',
    entries: [...manifests, ...references].map((path) => ({ file: byPath.get(path)!, path: pathInsideSkill(folder, path) })),
  }));
  const archives: Upload[] = [...byPath].filter(([path]) => packedSkill.test(path))
    .map(([path, file]) => ({ kind: 'file', file, label: path }));
  return [...directories, ...archives].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

async function directoryArchive(task: Extract<Upload, { kind: 'directory' }>) {
  const manifestCount = task.entries.filter(({ path }) => isSkillManifest(path)).length;
  if (manifestCount !== 1) throw new Error('每个 Skill 目录应只有一个 SKILL.md');
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const folder = task.label.includes('/') ? task.label.split('/').at(-1) : task.label;
  for (const { file, path } of task.entries) zip.file(folder + '/' + path, await file.arrayBuffer());
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

async function uploadSkill(task: Upload) {
  const markdown = task.kind === 'file' && /\.md$/i.test(task.file.name);
  const body = task.kind === 'file' ? task.file : await directoryArchive(task);
  const response = await workspaceFetch('/api/test-case-agent/extensions', {
    method: 'POST',
    headers: { 'Content-Type': markdown ? 'text/markdown' : 'application/zip' },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data?.skills)) throw new Error(data?.error ?? '导入失败');
  return data.skills as TextSkill[];
}

export async function importSkillSelection(files: File[], directory: boolean, progress: (done: number, total: number) => void) {
  const tasks: Upload[] = directory ? planFolderImport(files) : files.map((file) => ({ kind: 'file', file, label: file.name }));
  if (!tasks.length) throw new Error('所选文件夹中没有找到 SKILL.md、ZIP 或 .skill 压缩包。');
  const results = new Array<{ skills?: TextSkill[]; failure?: SkillImportFailure }>(tasks.length);
  let next = 0;
  let done = 0;
  progress(0, tasks.length);
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      const task = tasks[index];
      try {
        results[index] = { skills: await uploadSkill(task) };
      } catch (cause) {
        results[index] = { failure: { label: task.label, reason: cause instanceof Error ? cause.message : '导入失败' } };
      }
      progress(++done, tasks.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, tasks.length) }, worker));
  return { skills: results.flatMap(({ skills }) => skills ?? []), failures: results.flatMap(({ failure }) => failure ? [failure] : []) };
}

export function mergeImportedSkills(library: TextSkill[], active: TextSkill[], incoming: TextSkill[]) {
  const known = new Set(library.map(({ id }) => id));
  const added = incoming.filter((skill) => {
    if (known.has(skill.id)) return false;
    known.add(skill.id);
    return true;
  });
  return { library: [...library, ...added], active: [...active, ...added], addedCount: added.length };
}
