import { z } from 'zod';
import { errorResponse, parseRequest } from '@/lib/agent/modelConfig';
import { parseWorkspaceSave, workspaceOwner, workspaceReply } from '@/lib/workspaces/http';
import { workspaceStore } from '@/lib/workspaces/store';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const owner = workspaceOwner(request);
    const { id } = await context.params;
    return workspaceReply(workspaceStore().get(owner.id, id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const owner = workspaceOwner(request);
    const { id } = await context.params;
    const { version, snapshot } = await parseWorkspaceSave(request);
    return workspaceReply(workspaceStore().save(owner.id, id, version, snapshot));
  } catch (error) {
    return errorResponse(error);
  }
}

const renameSchema = z.object({ title: z.string().trim().min(1).max(120) });

export async function PATCH(request: Request, context: Context) {
  try {
    const owner = workspaceOwner(request);
    const { id } = await context.params;
    const { title } = await parseRequest(request, renameSchema);
    return workspaceReply(workspaceStore().rename(owner.id, id, title));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const owner = workspaceOwner(request);
    const { id } = await context.params;
    const selectNext = new URL(request.url).searchParams.get('selectNext') === '1';
    return workspaceReply(workspaceStore().remove(owner.id, id, selectNext));
  } catch (error) {
    return errorResponse(error);
  }
}
