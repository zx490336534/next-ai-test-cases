import { z } from 'zod';
import { errorResponse, parseRequest } from '@/lib/agent/modelConfig';
import { workspaceOwner, workspaceReply } from '@/lib/workspaces/http';
import { workspaceStore } from '@/lib/workspaces/store';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const owner = workspaceOwner(request, true);
    const response = workspaceReply(workspaceStore().list(owner.id));
    if (owner.cookie) response.headers.append('Set-Cookie', owner.cookie);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { id } = workspaceOwner(request);
    return workspaceReply(workspaceStore().create(id), 201);
  } catch (error) {
    return errorResponse(error);
  }
}

const reorderSchema = z.object({ id: z.uuid(), targetId: z.uuid(), placement: z.enum(['before', 'after']) });

export async function PATCH(request: Request) {
  try {
    const owner = workspaceOwner(request);
    const { id, targetId, placement } = await parseRequest(request, reorderSchema);
    return workspaceReply(workspaceStore().reorder(owner.id, id, targetId, placement));
  } catch (error) {
    return errorResponse(error);
  }
}
