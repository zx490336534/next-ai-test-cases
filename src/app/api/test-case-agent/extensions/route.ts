import { maxArchiveBytes, maxSkillFileBytes } from '@/lib/agent/extensionContracts';
import { listMcpSources } from '@/lib/agent/materials';
import { checkRequestOrigin, errorResponse, RequestError } from '@/lib/agent/modelConfig';
import { importSkills, listInstalledSkills, readUpload } from '@/lib/agent/skills';

const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  try {
    checkRequestOrigin(request);
    const [mcp, skills] = await Promise.all([listMcpSources(), listInstalledSkills()]);
    return Response.json({ mcp, skills }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    checkRequestOrigin(request);
    const type = request.headers.get('content-type')?.split(';')[0].trim();
    if (type !== 'application/zip' && type !== 'text/markdown') {
      throw new RequestError('请选择 ZIP、.skill 或 Markdown 文件', 415);
    }
    const markdown = type === 'text/markdown';
    const input = await readUpload(request, markdown ? maxSkillFileBytes : maxArchiveBytes);
    return Response.json({ skills: await importSkills(input, markdown) }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
