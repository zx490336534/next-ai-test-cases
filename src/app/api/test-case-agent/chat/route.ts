import { chatAndUpdateMindMap } from '@/lib/agent/chatEdits';
import { chatRequestSchema } from '@/lib/agent/contracts';
import { createModel } from '@/lib/agent/model';
import { errorResponse, modelRequestSchema, parseRequest, resolveModelSettings } from '@/lib/agent/modelConfig';

export async function POST(request: Request) {
  try {
    const input = await parseRequest(request, chatRequestSchema.merge(modelRequestSchema));
    const model = createModel(resolveModelSettings(input.settings), request.signal);
    return Response.json(await chatAndUpdateMindMap(model, input));
  } catch (error) {
    return errorResponse(error);
  }
}
