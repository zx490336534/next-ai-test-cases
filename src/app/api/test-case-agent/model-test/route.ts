import { createModel } from '@/lib/agent/model';
import { errorResponse, modelRequestSchema, parseRequest, resolveModelSettings } from '@/lib/agent/modelConfig';

export async function POST(request: Request) {
  try {
    const input = await parseRequest(request, modelRequestSchema);
    const model = createModel(resolveModelSettings(input.settings), request.signal);
    await model.invoke([{ role: 'user', content: 'Reply with OK.' }]);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
