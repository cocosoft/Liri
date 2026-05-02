export interface Session {
  id: string;
  title: string;
  created_at: number;
  last_modified_at: number;
  message_count: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  session_id: string;
  tool_calls?: ToolCall[];
}

export interface Tool {
  name: string;
  description: string;
  enabled: boolean;
  read_only: boolean;
  destructive: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

export interface Config {
  [key: string]: unknown;
}