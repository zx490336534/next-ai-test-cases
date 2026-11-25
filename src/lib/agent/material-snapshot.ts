import { sha256 } from '../sha256';
import type { TextSkill } from './extensionContracts';

export type MaterialSnapshot = { requirement: string; documents: { url: string; text: string }[]; missing: number; skills?: TextSkill[] };

export function requirementLinks(requirement: string) {
  return [...new Set((requirement.match(/https?:\/\/[^\s<>"'，。；、！？）)\]]+/gi) ?? []).map((url) => url.replace(/[.,;]+$/, '')))];
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
