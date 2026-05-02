/**
 * 流式输出模块类型定义
 */

export type StreamEventType =
  | 'content_block_delta'
  | 'content_block_start'
  | 'content_block_stop'
  | 'message_start'
  | 'message_delta'
  | 'message_stop';

export interface StreamEvent {
  type: StreamEventType;
  index?: number;
  delta?: {
    type: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
  };
  content_block?: {
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: any;
  };
  message?: {
    id: string;
    role: 'assistant';
    content: any[];
    model: string;
  };
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

export interface StreamChunk {
  content: string;
  isComplete: boolean;
  toolCalls?: {
    id: string;
    name: string;
    arguments: string;
    isComplete: boolean;
  }[];
}

export type StreamCallback = (chunk: StreamChunk) => void;
