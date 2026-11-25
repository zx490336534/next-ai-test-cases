import { conversationText } from '@/lib/agent/conversation';
import type { WorkspaceSnapshot } from './types';

export function titleFor(snapshot: WorkspaceSnapshot) {
  const first = snapshot.messages.find(({ role }) => role === 'user');
  const text = first ? conversationText(first).replace(/\s+/g, ' ') : '';
  return Array.from(text).slice(0, 42).join('') || '新会话';
}
