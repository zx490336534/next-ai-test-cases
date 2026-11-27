import { requirementSchema } from '@/lib/agent/contracts';
import { extensionsSchema, type Extensions } from '@/lib/agent/extensionContracts';
import type { SavedWorkspace } from '@/lib/workspaces/types';

type GenerationInput = { messageId: string; requirement: string; extensions: Extensions };
const prefix = 'next-ai-test-cases:generation:';

export function rememberGeneration(id: string, input?: GenerationInput) {
  try {
    if (input) sessionStorage.setItem(prefix + id, JSON.stringify(input));
    else sessionStorage.removeItem(prefix + id);
  } catch { /* Same-page retry remains available if tab storage is full. */ }
}

export function recoverGeneration(session: SavedWorkspace) {
  if (session.mindMap.children.length) return null;
  try {
    const raw = sessionStorage.getItem(prefix + session.id);
    if (!raw) return null;
    const input = JSON.parse(raw);
    const user = session.messages.findLast(({ role }) => role === 'user');
    if (!user || input.messageId !== user.id) return null;
    return { retry: { requirement: requirementSchema.parse(input.requirement) }, extensions: extensionsSchema.parse(input.extensions), errors: [] };
  } catch {
    return null;
  }
}
