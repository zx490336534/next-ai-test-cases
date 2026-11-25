import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { join, relative, sep } from 'node:path';
import { fromBufferPromise, openPromise, type Entry } from 'yauzl';
import type { TextSkill } from './extensionContracts';
import { RequestError } from './modelConfig';
import { groupSkillPaths, isSkillReference, pathInsideSkill } from './skillPaths';

const installedDirectory = 'skills';
const decoder = new TextDecoder('utf-8', { fatal: true });

function skillName(instructions: string, fallback: string) {
  const frontMatter = instructions.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const name = frontMatter?.[1].match(/^name:[ \t]*(.+)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  return (name?.trim() || fallback).slice(0, 120);
}

function decodeText(bytes: Uint8Array) {
  const text = decoder.decode(bytes).trim();
  if (text.includes('\0')) throw new RequestError('Skill 文件必须是 UTF-8 文本', 422);
  return text;
}

function loadedSkill(instructions: string, fallback: string, references: TextSkill['references']): TextSkill {
  if (!instructions) throw new RequestError('SKILL.md 不能为空', 422);
  const name = skillName(instructions, fallback);
  const id = createHash('sha256').update(JSON.stringify({ name, instructions, references })).digest('hex');
  return { id, name, instructions, references };
}

export async function importSkillUpload(request: Request, markdown: boolean) {
  if (!request.body) throw new RequestError('请选择 Skill 文件', 400);
  if (markdown) return importSkills(Buffer.from(await request.arrayBuffer()), true);
  const directory = await mkdtemp(join(tmpdir(), 'test-cases-skill-'));
  try {
    const path = join(directory, 'upload.zip');
    await pipeline(request.body, createWriteStream(path, { mode: 0o600 }), { signal: request.signal });
    return await importSkills(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function importSkills(archive: Buffer | string, markdown = false): Promise<TextSkill[]> {
  try {
    if (markdown && Buffer.isBuffer(archive)) {
      return [loadedSkill(decodeText(archive), '上传的 Skill', [])];
    }
    const fromDisk = typeof archive === 'string';
    const zip = fromDisk
      ? await openPromise(archive, { autoClose: false, validateEntrySizes: true })
      : await fromBufferPromise(archive, { validateEntrySizes: true });
    try {
      const entries = new Map<string, Entry>();
      for await (const entry of zip.eachEntry()) {
        const path = entry.fileName;
        if (path.startsWith('__MACOSX/') || path.endsWith('/')) continue;
        const fileType = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (fileType && fileType !== 0x8000) throw new RequestError('Skill 压缩包仅支持普通文件', 422);
        if (/[\p{Cc}]/u.test(path) || entries.has(path)) {
          throw new RequestError('Skill 压缩包存在无效或重复路径', 422);
        }
        entries.set(path, entry);
      }
      const groups = groupSkillPaths([...entries.keys()]).sort((a, b) => a.folder.localeCompare(b.folder));
      if (!groups.length) throw new RequestError('压缩包里没有找到 SKILL.md', 422);
      async function readText(entry: Entry) {
        const stream = await zip.openReadStreamPromise(entry);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        return decodeText(Buffer.concat(chunks));
      }
      const skills: TextSkill[] = [];
      for (const { folder, manifests, references: referencePaths } of groups) {
        if (manifests.length !== 1) throw new RequestError('每个 Skill 目录应只有一个 SKILL.md', 422);
        const instructions = await readText(entries.get(manifests[0])!);
        const references: TextSkill['references'] = [];
        for (const path of referencePaths.sort()) {
          const text = await readText(entries.get(path)!);
          if (text) references.push({ path: pathInsideSkill(folder, path), text });
        }
        skills.push(loadedSkill(instructions, folder ? folder.split('/').at(-1)! : '上传的 Skill', references));
      }
      return skills;
    } finally {
      const closed = fromDisk ? once(zip, 'close') : undefined;
      zip.close();
      await closed;
    }
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(markdown ? '无法读取 Skill Markdown，请检查 UTF-8 编码' : '无法解压 Skill，请上传有效且未加密的 ZIP 或 .skill 文件', 422);
  }
}

async function readLocalText(path: string) {
  const info = await lstat(path);
  if (!info.isFile()) throw new RequestError('已安装 Skill 含无效的文本文件', 422);
  return decodeText(await readFile(path));
}

async function installedEntries() {
  const entries = await readdir(installedDirectory, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && /^[\w-]{1,120}$/.test(entry.name));
}

export async function listInstalledSkills() {
  const skills = await Promise.all((await installedEntries()).sort((a, b) => a.name.localeCompare(b.name))
    .map(async ({ name: id }) => {
      const instructions = await readLocalText(join(installedDirectory, id, 'SKILL.md')).catch(() => '');
      return instructions ? { id, name: skillName(instructions, id) } : null;
    }));
  return skills.filter((skill) => skill !== null);
}

export async function resolveSkills(installed: string[] = [], imported: TextSkill[] = []) {
  if (!installed.length) return imported;
  const available = new Set((await installedEntries()).map((entry) => entry.name));
  const selected = [...imported];
  for (const id of new Set(installed)) {
    if (!available.has(id)) throw new RequestError('已安装 Skill 列表已变化，请重新选择', 400);
    const dir = join(installedDirectory, id);
    const instructions = await readLocalText(join(dir, 'SKILL.md'))
      .catch(() => { throw new RequestError('无法读取所选的 Skill', 422); });
    const refs = join(dir, 'references');
    const refDirectory = await lstat(refs).catch(() => null);
    const files = refDirectory?.isDirectory() ? await readdir(refs, { withFileTypes: true, recursive: true }) : [];
    const topLevel = await readdir(dir, { withFileTypes: true });
    const paths = [...topLevel, ...files].filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((path) => isSkillReference(relative(dir, path).split(sep).join('/'))).sort();
    const references: TextSkill['references'] = [];
    for (const path of paths) {
      const text = await readLocalText(path);
      if (text) references.push({ path: relative(dir, path).split(sep).join('/'), text });
    }
    selected.push(loadedSkill(instructions, id, references));
  }
  return selected;
}
