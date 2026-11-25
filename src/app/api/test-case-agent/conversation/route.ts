import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { z } from 'zod';
import { chatAndUpdateMindMap } from '@/lib/agent/chatEdits';
import type { ConversationEvent, ConversationMessage } from '@/lib/agent/conversation';
import { chatRequestSchema, requirementSchema } from '@/lib/agent/contracts';
import { extensionsSchema } from '@/lib/agent/extensionContracts';
import type { FollowUp } from '@/lib/agent/follow-ups';
import { resolveSkills } from '@/lib/agent/skills';
import { generationConcurrency, retrySchema, runGeneration, type Activity, type GenerationEvent } from '@/lib/agent/generation';
import { collectMaterials, requirementLinks } from '@/lib/agent/materials';
import { createModel, modelError } from '@/lib/agent/model';
import { errorResponse, modelRequestSchema, parseRequest, resolveModelSettings } from '@/lib/agent/modelConfig';

const conversationSchema = chatRequestSchema.merge(modelRequestSchema).extend({
  extensions: extensionsSchema.optional(),
  originalRequirement: requirementSchema.optional(),
  selectedNodeId: z.string().max(300).optional(),
  retry: z.object({ requirement: requirementSchema, plan: retrySchema }).optional(),
}).refine(({ messages }) => messages.at(-1)?.role === 'user');

export async function POST(request: Request) {
  try {
    const input = await parseRequest(request, conversationSchema);
    const config = resolveModelSettings(input.settings);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12 * 60_000)]);
    const model = createModel(config, signal);
    const stream = createUIMessageStream<ConversationMessage>({
      onError: modelError,
      async execute({ writer }) {
        const start = performance.now();
        let followUps: FollowUp[] | undefined;
        function finish(finishReason: 'stop' | 'error') {
          const { calls, reported, totalTokens, detailed, inputTokens, outputTokens } = model.usage;
          writer.write({
            type: 'finish',
            finishReason,
            messageMetadata: {
              ...(followUps?.length && { followUps }),
              execution: {
                elapsedMs: Math.round(performance.now() - start),
                usage: { calls, reported, totalTokens, ...(detailed === reported && { inputTokens, outputTokens }) },
              },
            },
          });
        }
        const emitData = (data: ConversationEvent) => writer.write({ type: 'data-workspace', data, transient: true });
        const started = new Set<string>();
        function trace({ id, kind, label, state, detail }: Activity) {
          const toolName = kind === 'tool' ? 'read_materials' : 'workspace_step';
          if (!started.has(id)) {
            writer.write({ type: 'tool-input-available', toolCallId: id, toolName, dynamic: true, input: { label } });
            started.add(id);
          }
          if (state === 'error') {
            writer.write({ type: 'tool-output-error', toolCallId: id, dynamic: true, errorText: detail ?? '操作失败' });
          } else if (state !== 'running') {
            writer.write({ type: 'tool-output-available', toolCallId: id, dynamic: true, output: { state, detail } });
          }
        }
        function text(value: string) {
          const id = 'reply';
          const content = value.trim();
          if (!content) return;
          writer.write({ type: 'text-start', id });
          writer.write({ type: 'text-delta', id, delta: content });
          writer.write({ type: 'text-end', id });
        }
        writer.write({ type: 'start' });
        try {
          const editing = input.currentMindMap.children.length > 0 && !input.retry;
          const requirement = input.retry?.requirement ?? input.messages.at(-1)!.content;
          const hasLinks = requirementLinks(requirement).length > 0;
          const source = { id: 'materials', kind: 'tool' as const, label: '读取外部资料' };
          const skills = await resolveSkills(input.extensions?.installedSkillIds, input.extensions?.importedSkills);
          if (skills.length) trace({
            id: 'skills', kind: 'step', label: '载入 Skill', state: 'done', detail: '已载入 ' + skills.length + ' 个 Skill',
          });
          if (hasLinks) trace({ ...source, state: 'running' });
          const materials = await collectMaterials(requirement, signal, input.extensions?.mcpIds);
          if (skills.length) materials.skills = skills;
          if (hasLinks) trace({
            ...source, state: materials.missing ? 'warning' : 'done',
            detail: '已读取 ' + materials.documents.length + ' 份' + (materials.missing ? '，' + materials.missing + ' 份不可用' : ''),
          });
          if (editing) {
            if (materials.missing) emitData({ type: 'warning', message: materials.missing + ' 份资料未读取。' });
            const step = { id: 'chat', kind: 'step' as const, label: '解析指令并校验修改范围' };
            trace({ ...step, state: 'running' });
            const update = await chatAndUpdateMindMap(model, { ...input, materials, followUpContext: {
              originalRequirement: input.originalRequirement, selectedNodeId: input.selectedNodeId,
            } });
            signal.throwIfAborted();
            trace({ ...step, state: 'done', detail: '已返回节点修改建议或澄清' });
            emitData({ type: 'edit', mindMap: update.mindMap });
            followUps = update.followUps;
            text(update.assistantReply);
          } else {
            function emit(event: GenerationEvent) {
              if (event.type === 'activity') trace(event.item);
              else {
                emitData(event);
                if (event.type === 'complete') {
                  followUps = event.followUps;
                  text(event.summary || '用例脑图已生成。');
                }
              }
            }
            await runGeneration({ model, materials, concurrency: generationConcurrency, retry: input.retry?.plan, signal, emit, suggestFollowUps: true });
          }
          finish('stop');
        } catch (error) {
          if (request.signal.aborted) return;
          const message = signal.aborted ? '操作超时，当前脑图仍保留' : modelError(error);
          emitData({ type: 'error', message });
          text(message);
          finish('error');
        }
      },
    });
    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    return errorResponse(error);
  }
}
