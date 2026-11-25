import { z } from 'zod';

const suggestion = z.object({
  anchor: z.string().trim().min(2).max(48),
  text: z.string().trim().min(8).max(104),
});

export type FollowUp = z.infer<typeof suggestion>;
export const followUpsSchema = z.array(suggestion).max(3);

export const followUpPrompt = [
  'followUps 是本轮完成后用户最可能直接发送的 0 至 3 条追问，每条形如 {"anchor":"已有资料或相关用例里的原词","text":"用户实际会输入的话"}。',
  '从最新需求、最近对话和本轮真正生成或修改的用例出发。优先选尚未覆盖的边界、需要核对的实际结果、用户刚调整后自然会关心的相邻场景，或确实缺失的验收规则。',
  '每条只问一个具体问题，写出对象、触发条件或要核对的行为。像测试同事说话，直接写问题或修改指令，避免“帮我检查覆盖”“扩展异常场景”等无对象模板。不要重复本轮已完成的事项。',
  'anchor 必须是上下文里能逐字找到的有辨识度的业务短语，也必须原样包含在 text 中。避免使用“用例”“模块”“边界”等通用词作为 anchor。',
  '未知的条件写成需要确认的问题，不能预设新的接口、阈值、账号或产品功能。资料不足时少写或返回空数组。',
  '范例仅用于说明问法：如果原需求提到“被邀请邮箱”，可问“登录邮箱和被邀请邮箱不一致时，帮我补一条拒绝加入的用例。”',
].join('\n');

const genericAnchors = new Set(['用例', '测试', '模块', '需求', '边界', '系统', '功能', '场景', '页面', '结果', '操作', '流程', '步骤']);

function comparable(text: string) {
  return text.replace(/[\p{P}\s]+/gu, '').toLowerCase();
}

export function groundedFollowUps(raw: unknown, facts: string[], previous: string[] = []): FollowUp[] {
  if (!Array.isArray(raw)) return [];
  const sources = facts.map((text) => text.replace(/\s+/g, ' ')).join('\n');
  const seen = new Set(previous.map(comparable));
  const result: FollowUp[] = [];
  for (const item of raw) {
    const parsed = suggestion.safeParse(item);
    if (!parsed.success) continue;
    const { anchor, text } = parsed.data;
    if (genericAnchors.has(anchor) || !sources.includes(anchor) || !text.includes(anchor)) continue;
    const key = comparable(text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ anchor, text });
    if (result.length === 3) break;
  }
  return result;
}
