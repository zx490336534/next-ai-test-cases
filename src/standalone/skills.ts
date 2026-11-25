import JSZip from 'jszip';
import type { TextSkill } from '@/lib/agent/extensionContracts';
import { RequestError } from '@/lib/agent/modelConfig';
import { groupSkillPaths, pathInsideSkill } from '@/lib/agent/skillPaths';
import { decodeText, loadedSkill } from '@/lib/agent/skill-text';

export async function importBrowserSkills(request: Request): Promise<TextSkill[]> {
  const type = request.headers.get('content-type')?.split(';')[0].trim();
  if (type !== 'text/markdown' && type !== 'application/zip') {
    throw new RequestError('请选择 ZIP、.skill 或 Markdown 文件', 415);
  }
  const markdown = type === 'text/markdown';
  try {
    const bytes = await request.arrayBuffer();
    if (markdown) return [await loadedSkill(decodeText(new Uint8Array(bytes)), '上传的 Skill', [])];
    const zip = await JSZip.loadAsync(bytes);
    const paths: string[] = [];
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const path = entry.name;
      if (path !== entry.unsafeOriginalName || /[\\\p{Cc}]/u.test(path) || /^[a-z]:/i.test(path)
        || path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
        throw new RequestError('Skill 压缩包存在无效路径', 422);
      }
      if (path.startsWith('__MACOSX/')) continue;
      const mode = Number(entry.unixPermissions) & 0xf000;
      if (mode && mode !== 0x8000) throw new RequestError('Skill 压缩包仅支持普通文件', 422);
      paths.push(path);
    }
    const groups = groupSkillPaths(paths).sort((a, b) => a.folder.localeCompare(b.folder));
    if (!groups.length) throw new RequestError('压缩包里没有找到 SKILL.md', 422);
    async function readText(path: string) {
      request.signal.throwIfAborted();
      return decodeText(await zip.files[path].async('uint8array'));
    }
    const skills: TextSkill[] = [];
    for (const { folder, manifests, references: referencePaths } of groups) {
      if (manifests.length !== 1) throw new RequestError('每个 Skill 目录应只有一个 SKILL.md', 422);
      const instructions = await readText(manifests[0]);
      const references: TextSkill['references'] = [];
      for (const path of referencePaths.sort()) {
        const text = await readText(path);
        if (text) references.push({ path: pathInsideSkill(folder, path), text });
      }
      skills.push(await loadedSkill(instructions, folder.split('/').at(-1) || '上传的 Skill', references));
    }
    return skills;
  } catch (error) {
    request.signal.throwIfAborted();
    if (error instanceof RequestError) throw error;
    throw new RequestError(markdown ? '无法读取 Skill Markdown，请检查 UTF-8 编码' : '无法解压 Skill，请上传有效且未加密的 ZIP 或 .skill 文件', 422);
  }
}
