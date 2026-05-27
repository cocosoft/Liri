import type { Message } from '@modules/chat/types/message';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
}

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ActiveToolCall {
  toolCallId: string;
  toolName: string;
  startedAt: number;
  status: 'running' | 'done';
}

export interface ToolCallStatus {
  toolCallId: string;
  toolName: string;
  progress: number;
  message: string;
  status: 'running' | 'completed' | 'failed';
}

export interface StreamStats {
  startTime: number;
  tokenCount: number;
  currentSpeed: number;
}

export type StreamState = 'idle' | 'streaming' | 'paused' | 'done';

export interface ReplInkProps {
  chatManager: ChatManager;
  onExit: () => void;
}

export interface ChatManager {
  streamMessage(
    content: string,
    options?: {
      sessionId?: string;
      onStream?: (chunk: string) => void;
      onComplete?: (message: Message) => void;
    }
  ): AsyncGenerator<string, Message, unknown>;
  getCurrentSession(): { id: string } | undefined;
  getSessionMessages?(sessionId: string): Message[];
  createSession?(params: { title: string }): { id: string };
}
