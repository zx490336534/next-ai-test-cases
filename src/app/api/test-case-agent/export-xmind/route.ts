import { errorResponse, parseRequest } from '@/lib/agent/modelConfig';
import { exportXMind, xmindSchema } from '@/lib/agent/xmind';

export async function POST(request: Request) {
  try {
    return await exportXMind(await parseRequest(request, xmindSchema));
  } catch (error) {
    return errorResponse(error);
  }
}
