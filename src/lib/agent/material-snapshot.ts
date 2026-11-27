import { sha256 } from '../sha256';
import type { TextSkill } from './extensionContracts';
import { z } from 'zod';

export const materialLimit = 4;
const offset = z.number().int().nonnegative();
const rangeSchema = z.object({
  serverId: z.string().min(1),
  start: offset,
  end: offset,
  total: offset,
}).refine(({ start, end, total }) => start < end && end <= total);
const sourceSchema = z.object({ url: z.url({ protocol: /^https?$/ }), range: rangeSchema.optional() });
export const materialSourcesSchema = z.array(sourceSchema).max(materialLimit);
export type MaterialSource = z.infer<typeof sourceSchema>;
export type MaterialSnapshot = {
  requirement: string;
  documents: { url: string; text: string; range?: MaterialSource['range'] }[];
  missing: number;
  skills?: TextSkill[];
};

export function requirementLinks(requirement: string) {
  return [...new Set((requirement.match(/https?:\/\/[^\s<>"'，。；、！？）)\]]+/gi) ?? []).map((url) => url.replace(/[.,;]+$/, '')))];
}

export function materialReadIntent(instruction: string) {
  if (/(?:原文|资料|文档)的?(?:末尾|结尾|末段|最后一[段节章])|^(?:请)?(?:读取?)?(?:末尾|结尾|末段|最后一段)|\b(?:tail|end) of (?:the )?document\b/iu.test(instruction)) return 'tail';
  if (/(?:原文|资料|文档)的?(?:开头|首段|第一[段节章])|^(?:请)?(?:读取?)?(?:开头|首段)|\bbeginning of (?:the )?document\b/iu.test(instruction)) return 'head';
  if (/继续(?:读|阅读|看下一)|补读|续读|下一段|\b(?:continue reading|next (?:section|page))\b/iu.test(instruction)) return 'next';
  if (/原文|资料|文档|原需求|需求(?:中|里|说明)|(?:按(?:照)?|参照|根据|依据|对照|核对)(?:之前的|上次的|现有的)?需求|\b(?:docs?|document|specification|prd|source material|original (?:requirement|text))\b/iu.test(instruction)) return 'reference';
}

export function hasRequirementText(requirement: string, links: string[]) {
  const prose = links.reduce((text, link) => text.replaceAll(link, ''), requirement);
  // Treat a link label as distinct from usable requirement text.
  return /[\p{L}\p{N}]{12}/u.test(prose.replace(/[^\p{L}\p{N}]/gu, ''))
    && /\d|\b(?:must|allows?|supports?|when|after|before|only|can|cannot|should|requires?)\b|只能|不能|禁止|支持|必须|需要|允许|失败|成功|为空|点击|展示|限制|拒绝|默认/iu.test(prose);
}

export function materialDigest(snapshot: MaterialSnapshot) {
  return sha256(JSON.stringify(snapshot));
}
