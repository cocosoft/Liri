export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface ConversationMessage extends Message {
  conversationId: string;
  parentId?: string;
}
