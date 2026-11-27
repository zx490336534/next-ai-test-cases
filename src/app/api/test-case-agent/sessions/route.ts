import { reorderSchema } from '@/lib/workspaces/validation';
import { errorResponse, parseRequest } from '@/lib/agent/modelConfig';
import { parseWorkspaceSave, workspaceOwner, workspaceReply } from '@/lib/workspaces/http';
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
    const change = request.headers.get('content-type')?.startsWith('application/json') ? await parseWorkspaceSave(request) : undefined;
    return workspaceReply(workspaceStore().create(id, change?.snapshot), 201);
  } catch (error) {
    return errorResponse(error);
  }
}


export async function PATCH(request: Request) {
  try {
    const owner = workspaceOwner(request);
    const { id, targetId, placement } = await parseRequest(request, reorderSchema);
    return workspaceReply(workspaceStore().reorder(owner.id, id, targetId, placement));
  } catch (error) {
    return errorResponse(error);
  }
}
