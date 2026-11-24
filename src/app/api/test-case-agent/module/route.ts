import { z } from 'zod';
import { moduleSchema, requirementSchema } from '@/lib/agent/contracts';
import { collectMaterials } from '@/lib/agent/materials';
import { createModel } from '@/lib/agent/model';
import { errorResponse, modelRequestSchema, parseRequest, resolveModelSettings } from '@/lib/agent/modelConfig';
import { generateModuleTestCases } from '@/lib/agent/testCaseAgent';

const requestSchema = modelRequestSchema.extend({
  requirement: requirementSchema,
  module: moduleSchema,
  modules: z.array(moduleSchema).max(8),
});

export async function POST(request: Request) {
  try {
    const input = await parseRequest(request, requestSchema);
    const model = createModel(resolveModelSettings(input.settings), request.signal);
    const materials = await collectMaterials(input.requirement, request.signal);
    return Response.json(await generateModuleTestCases(model, materials, input.module, input.modules));
  } catch (error) {
    return errorResponse(error);
  }
}
