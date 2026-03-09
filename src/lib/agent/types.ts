export type TestCaseItem = {
  id: string;
  category: string;
  topic: string;
  precondition: string;
  steps: string;
  expected: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
};

export type MindMapNode = {
  data: { text: string };
  children: MindMapNode[];
};

export type TestCaseAgentResult = {
  summary: string;
  cases: TestCaseItem[];
  mindMap: MindMapNode;
};

export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type MindMapChatResult = {
  assistantReply: string;
  mindMap: MindMapNode;
};
