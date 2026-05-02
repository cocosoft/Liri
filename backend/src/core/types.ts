/**
 * 核心类型定义
 */

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult<T = unknown> {
  success?: boolean;
  output?: string;
  error?: string;
  data?: T;
  newMessages?: Message[];
  contextModifier?: (context: any) => any;
  mcpMeta?: {
    _meta?: Record<string, unknown>;
    structuredContent?: Record<string, unknown>;
  };
}

export interface ToolContext {
  cwd: string;
  apiKey?: string;
}
