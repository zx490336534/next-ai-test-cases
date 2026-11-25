import type { ConversationMessage } from '@/lib/agent/conversation';
import type { MindMapNode } from '@/lib/agent/types';

export type WorkspaceSnapshot = {
  messages: ConversationMessage[];
  mindMap: MindMapNode;
};

export type WorkspaceSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

export type SavedWorkspace = WorkspaceSummary & WorkspaceSnapshot & {
  version: number;
};

export type RemovedWorkspace = {
  sessions: WorkspaceSummary[];
  nextSession: SavedWorkspace | null;
};
