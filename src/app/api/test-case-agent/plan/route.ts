import { requirementSchema } from '@/lib/agent/contracts';
import { collectMaterials } from '@/lib/agent/materials';
import { createModel } from '@/lib/agent/model';
import { errorResponse, modelRequestSchema, parseRequest, resolveModelSettings } from '@/lib/agent/modelConfig';
import { planTestCaseModules } from '@/lib/agent/testCaseAgent';

export async function POST(request: Request) {
  try {
    const input = await parseRequest(request, modelRequestSchema.extend({ requirement: requirementSchema }));
    const model = createModel(resolveModelSettings(input.settings), request.signal);
    const materials = await collectMaterials(input.requirement, request.signal);
    return Response.json(await planTestCaseModules(model, materials));
  } catch (error) {
    return errorResponse(error);
  }
}
