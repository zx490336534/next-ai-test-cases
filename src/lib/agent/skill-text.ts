import { sha256 } from '../sha256';
import type { TextSkill } from './extensionContracts';
import { RequestError } from './modelConfig';

const decoder = new TextDecoder('utf-8', { fatal: true });

export function skillName(instructions: string, fallback: string) {
  const frontMatter = instructions.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const name = frontMatter?.[1].match(/^name:[ \t]*(.+)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  return (name?.trim() || fallback).slice(0, 120);
}

export function decodeText(bytes: Uint8Array) {
  const text = decoder.decode(bytes).trim();
  if (text.includes('\0')) throw new RequestError('Skill 文件必须是 UTF-8 文本', 422);
  return text;
}

export async function loadedSkill(instructions: string, fallback: string, references: TextSkill['references']): Promise<TextSkill> {
  if (!instructions) throw new RequestError('SKILL.md 不能为空', 422);
  const name = skillName(instructions, fallback);
  const id = await sha256(JSON.stringify({ name, instructions, references }));
  return { id, name, instructions, references };
}
