import { EMPTY_MAP, normalizeMindMap } from '@/lib/agent/mindMap';
import { titleFor } from '@/lib/workspaces/title';
import type { SavedWorkspace, WorkspaceSnapshot, WorkspaceSummary } from '@/lib/workspaces/types';

export type WorkspaceDraft = {
  version: number;
  writeIds?: string[];
  snapshot: WorkspaceSnapshot;
};

const prefix = 'next-ai-test-cases:unsaved:';
const composerPrefix = 'next-ai-test-cases:composer:';
const memoryDrafts = new Map<string, string>();

export function readComposerDraft(id: string): string {
  if (memoryDrafts.has(id)) return memoryDrafts.get(id)!;
  try { return sessionStorage.getItem(composerPrefix + id) ?? ''; } catch { return ''; }
}

export function writeComposerDraft(id: string, text: string): boolean {
  try {
    if (text) sessionStorage.setItem(composerPrefix + id, text);
    else sessionStorage.removeItem(composerPrefix + id);
    memoryDrafts.delete(id);
    return true;
  } catch {
    // Keep the latest value when switching sessions, even if the browser refuses tab storage.
    memoryDrafts.set(id, text);
    return false;
  }
}

export function newWorkspaceWriteId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export function workspaceSnapshot({ messages, mindMap }: WorkspaceSnapshot): WorkspaceSnapshot {
  return { messages, mindMap: normalizeMindMap(mindMap) };
}

export function deletedWorkspaceDraft(lastId: string | null, history: WorkspaceSummary[]) {
  if (!lastId || history.some(({ id }) => id === lastId)) return;
  const draft = readWorkspaceDraft(lastId);
  if (draft) return { id: lastId, title: titleFor(draft.snapshot), updatedAt: '', version: draft.version, ...draft.snapshot };
  if (readComposerDraft(lastId)) return { id: lastId, title: '未发送的草稿', updatedAt: '', version: 0, messages: [], mindMap: EMPTY_MAP };
}

export function readWorkspaceDraft(id: string): WorkspaceDraft | undefined {
  try {
    const text = sessionStorage.getItem(prefix + id);
    if (!text) return;
    const draft: WorkspaceDraft = JSON.parse(text);
    if (!Number.isSafeInteger(draft?.version) || draft.version < 0
      || !Array.isArray(draft.snapshot?.messages) || !draft.snapshot.mindMap?.data
      || !Array.isArray(draft.snapshot.mindMap.children)
      || (draft.writeIds !== undefined && (!Array.isArray(draft.writeIds) || draft.writeIds.some((id) => typeof id !== 'string')))) return;
    return draft;
  } catch {
    return undefined;
  }
}

export function writeWorkspaceDraft(id: string, draft?: WorkspaceDraft): boolean {
  try {
    if (draft) sessionStorage.setItem(prefix + id, JSON.stringify(draft));
    else sessionStorage.removeItem(prefix + id);
    return true;
  } catch {
    return false;
  }
}

export function acknowledgedWrite(session: SavedWorkspace, version: number, writeIds: readonly string[] = []) {
  return Boolean(session.writeId && session.version === version + 1 && writeIds.includes(session.writeId));
}

export function recoverWorkspaceDraft(session: SavedWorkspace, draft = readWorkspaceDraft(session.id)) {
  if (!draft) return {};
  if (session.version === draft.version || acknowledgedWrite(session, draft.version, draft.writeIds)) {
    return { recovered: draft };
  }
  return { conflict: draft };
}
