/**
 * AI模型类型定义（整合llm/types.ts
 */

export enum AIModelType {
  CLAUDE_3_HAIKU = 'claude-3-haiku-20240307',
  CLAUDE_3_SONNET = 'claude-3-sonnet-20240229',
  CLAUDE_3_OPUS = 'claude-3-opus-20240229',
  GPT_3_5_TURBO = 'gpt-3.5-turbo',
  GPT_4 = 'gpt-4',
  GPT_4_TURBO = 'gpt-4-turbo',
  DEEPSEEK_CHAT = 'deepseek-chat',
  DEEPSEEK_CODER = 'deepseek-coder',
}

export enum AIMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
  TOOL = 'tool',
}

export interface AIMessage {
  role: AIMessageRole;
  content: string;
  timestamp?: number;
  id?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface AIResponseUsage {
  prompt_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface AIResponse {
  id: string;
  model: string;
  content: string;
  usage?: AIResponseUsage;
  timestamp: number;
  finish_reason?: string;
  tool_calls?: ParsedToolCall[];
}

export interface AIRequestParams {
  model: AIModelType;
  messages: AIMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  tools?: ToolDefinition[];
}

export interface AIClient {
  generate(params: AIRequestParams): Promise<AIResponse>;
  stream(params: AIRequestParams): AsyncGenerator<AIResponse>;
  getModelInfo(
    model: AIModelType
  ): Promise<{ name: string; contextWindow: number }>;
}

export interface AIServiceConfig {
  defaultModel: AIModelType;
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface AIService {
  generate(
    messages: AIMessage[],
    model?: AIModelType,
    options?: Partial<AIRequestParams>
  ): Promise<AIResponse>;
  stream(
    messages: AIMessage[],
    model?: AIModelType,
    options?: Partial<AIRequestParams>
  ): AsyncGenerator<AIResponse>;
  setDefaultModel(model: AIModelType): void;
  getDefaultModel(): AIModelType;
  updateConfig(config: Partial<AIServiceConfig>): void;
  getConfig(): AIServiceConfig;
}

// LLM类型定义（从llm/types.ts整合）
export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  tool_result?: {
    tool_call_id: string;
    content: string;
    is_error: boolean;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ChatResponse {
  content: string;
  model?: string;
  stop_reason: 'stop' | 'tool_calls' | 'max_tokens';
  tool_calls?: ParsedToolCall[];
  usage?: {
    prompt_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
