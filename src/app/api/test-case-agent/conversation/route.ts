import { conversationSchema, streamConversation } from '@/lib/agent/conversation-run';
import { collectMaterials } from '@/lib/agent/materials';
import { errorResponse, parseRequest, resolveModelSettings } from '@/lib/agent/modelConfig';
import { resolveSkills } from '@/lib/agent/skills';

export async function POST(request: Request) {
  try {
    const input = await parseRequest(request, conversationSchema);
    return streamConversation(input, resolveModelSettings(input.settings), request.signal, {
      readsLinks: true, collectMaterials, resolveSkills,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
