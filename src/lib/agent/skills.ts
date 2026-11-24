import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fromBufferPromise, type Entry } from 'yauzl';
import { maxArchiveBytes, maxImportedSkills, maxSkillContext, maxSkillFileBytes, skillContextSize, type TextSkill } from './extensionContracts';
import { RequestError } from './modelConfig';

const installedDirectory = 'skills';
const rootFile = /(?:^|\/)SKILL\.md$/i;
const textReference = /\.(?:md|txt|json|yaml|yml|csv)$/i;
const maxArchiveEntries = 512;
const maxArchiveTextBytes = 256 * 1024;
const maxReferences = 32;
const decoder = new TextDecoder('utf-8', { fatal: true });

function isReference(path: string) {
  return path.startsWith('references/') ? textReference.test(path)
    : !path.includes('/') && !rootFile.test(path) && /\.(md|txt)$/i.test(path);
}

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

function checkSkills(skills: TextSkill[]) {
  if (skillContextSize(skills) > maxSkillContext) {
    throw new RequestError('Skill 文本与资料总计不能超过 40,000 字符', 413);
  }
}

function loadedSkill(instructions: string, fallback: string, references: TextSkill['references']): TextSkill {
  if (!instructions) throw new RequestError('SKILL.md 不能为空', 422);
  const name = skillName(instructions, fallback);
  const id = createHash('sha256').update(JSON.stringify({ name, instructions, references })).digest('hex');
  return { id, name, instructions, references };
}

export async function readUpload(request: Request, limit: number) {
  if (Number(request.headers.get('content-length')) > limit) throw new RequestError('Skill 文件超过上传大小限制', 413);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!reader) throw new RequestError('请选择 Skill 文件', 400);
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw new RequestError('Skill 文件超过上传大小限制', 413);
      }
      chunks.push(result.value);
    }
    if (!size) throw new RequestError('Skill 文件不能为空', 400);
    return Buffer.concat(chunks, size);
  } finally {
    reader.releaseLock();
  }
}

export async function importSkills(archive: Buffer, markdown = false): Promise<TextSkill[]> {
  try {
    if (markdown) {
      if (archive.length > maxSkillFileBytes) throw new RequestError('单个 Skill 文本文件不能超过 64 KB', 413);
      const skills = [loadedSkill(decodeText(archive), '上传的 Skill', [])];
      checkSkills(skills);
      return skills;
    }
    if (archive.length > maxArchiveBytes) throw new RequestError('Skill ZIP 压缩包不能超过 8 MB', 413);
    const zip = await fromBufferPromise(archive, { validateEntrySizes: true });
    try {
      if (zip.entryCount > maxArchiveEntries) throw new RequestError('Skill 压缩包最多允许 512 个条目', 413);
      const entries = new Map<string, Entry>();
      for await (const entry of zip.eachEntry()) {
        const path = entry.fileName;
        if (path.startsWith('__MACOSX/') || path.endsWith('/')) continue;
        const fileType = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (fileType && fileType !== 0x8000) throw new RequestError('Skill 压缩包仅支持普通文件', 422);
        if (path.length > 300 || /[\p{Cc}]/u.test(path) || entries.has(path)) {
          throw new RequestError('Skill 压缩包存在无效或重复路径', 422);
        }
        entries.set(path, entry);
      }
      const roots = [...entries.keys()].filter((path) => rootFile.test(path)).sort();
      if (!roots.length) throw new RequestError('压缩包里没有找到 SKILL.md', 422);
      if (roots.length > maxImportedSkills) throw new RequestError('单个压缩包最多包含 8 个 Skill', 413);
      const ownerOf = (path: string) => roots.filter((root) => dirname(root) === '.' || path.startsWith(dirname(root) + '/'))
        .sort((left, right) => dirname(right).length - dirname(left).length)[0];
      let total = 0;
      async function readText(entry: Entry) {
        total += entry.uncompressedSize;
        if (entry.uncompressedSize > maxSkillFileBytes || total > maxArchiveTextBytes) {
          throw new RequestError('单个 Skill 文本文件不能超过 64 KB，ZIP 文本解压总量不能超过 256 KB', 413);
        }
        const stream = await zip.openReadStreamPromise(entry);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        return decodeText(Buffer.concat(chunks));
      }
      const skills: TextSkill[] = [];
      for (const root of roots) {
        const folder = dirname(root);
        const prefix = folder === '.' ? '' : folder + '/';
        const referencePaths = [...entries.keys()].filter((path) => path.startsWith(prefix)
          && isReference(path.slice(prefix.length)) && ownerOf(path) === root).sort();
        if (referencePaths.length > maxReferences) throw new RequestError('每个 Skill 最多加载 32 份文本资料', 413);
        const instructions = await readText(entries.get(root)!);
        const references: TextSkill['references'] = [];
        for (const path of referencePaths) {
          const text = await readText(entries.get(path)!);
          if (text) references.push({ path: path.slice(prefix.length), text });
        }
        skills.push(loadedSkill(instructions, folder === '.' ? '上传的 Skill' : folder.split('/').at(-1)!, references));
      }
      checkSkills(skills);
      return skills;
    } finally {
      zip.close();
    }
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(markdown ? '无法读取 Skill Markdown，请检查 UTF-8 编码' : '无法解压 Skill，请上传有效且未加密的 ZIP 或 .skill 文件', 422);
  }
}

async function readLocalText(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > maxSkillFileBytes) throw new RequestError('已安装 Skill 含无效或过大的文本文件', 422);
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
      .filter((path) => isReference(relative(dir, path).split(sep).join('/'))).sort();
    if (paths.length > maxReferences) throw new RequestError('每个 Skill 最多加载 32 份文本资料', 413);
    const references: TextSkill['references'] = [];
    for (const path of paths) {
      const text = await readLocalText(path);
      if (text) references.push({ path: relative(dir, path).split(sep).join('/'), text });
    }
    selected.push(loadedSkill(instructions, id, references));
    checkSkills(selected);
  }
  return selected;
}
