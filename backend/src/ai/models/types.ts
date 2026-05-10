/**
 * AI模型类型定义（整合llm/types.ts）
 * 参考CC源码: cc_code/backend/utils/model/types.ts
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

/**
 * 模型能力枚举
 */
export enum ModelCapability {
  STREAMING = 'streaming',
  FUNCTION_CALLING = 'function_calling',
  VISION = 'vision',
  THINKING = 'thinking',
  EXTENDED_THINKING = 'extended_thinking',
  TOOL_USE = 'tool_use',
  COMPUTER_USE = 'computer_use',
  BASH_SANDBOX = 'bash_sandbox',
  CONTEXT_CACHING = 'context_caching',
  PROMPT_CACHING = 'prompt_caching',
  STRUCTURED_OUTPUT = 'structured_output',
  FILES_API = 'files_api',
  BATCH_API = 'batch_api',
  PARALLEL_TOOL_CALLS = 'parallel_tool_calls',
  IMAGE_INPUT = 'image_input',
  PDF_INPUT = 'pdf_input',
  CODE_EXECUTION = 'code_execution',
}

/**
 * 模型能力映射
 */
export const MODEL_CAPABILITIES: Record<string, ModelCapability[]> = {
  'claude-opus-4-6': [
    ModelCapability.STREAMING,
    ModelCapability.FUNCTION_CALLING,
    ModelCapability.VISION,
    ModelCapability.THINKING,
    ModelCapability.EXTENDED_THINKING,
    ModelCapability.TOOL_USE,
    ModelCapability.COMPUTER_USE,
    ModelCapability.BASH_SANDBOX,
    ModelCapability.CONTEXT_CACHING,
    ModelCapability.STRUCTURED_OUTPUT,
    ModelCapability.PARALLEL_TOOL_CALLS,
    ModelCapability.IMAGE_INPUT,
    ModelCapability.PDF_INPUT,
  ],
  'claude-opus-4-5-20251101': [
    ModelCapability.STREAMING,
    ModelCapability.FUNCTION_CALLING,
    ModelCapability.VISION,
    ModelCapability.THINKING,
    ModelCapability.EXTENDED_THINKING,
    ModelCapability.TOOL_USE,
    ModelCapability.COMPUTER_USE,
    ModelCapability.BASH_SANDBOX,
    ModelCapability.CONTEXT_CACHING,
    ModelCapability.STRUCTURED_OUTPUT,
    ModelCapability.PARALLEL_TOOL_CALLS,
    ModelCapability.IMAGE_INPUT,
    ModelCapability.PDF_INPUT,
  ],
  'claude-sonnet-4-6': [
    ModelCapability.STREAMING,
    ModelCapability.FUNCTION_CALLING,
    ModelCapability.VISION,
    ModelCapability.THINKING,
    ModelCapability.EXTENDED_THINKING,
    ModelCapability.TOOL_USE,
    ModelCapability.COMPUTER_USE,
    ModelCapability.BASH_SANDBOX,
    ModelCapability.CONTEXT_CACHING,
    ModelCapability.STRUCTURED_OUTPUT,
    ModelCapability.PARALLEL_TOOL_CALLS,
    ModelCapability.IMAGE_INPUT,
    ModelCapability.PDF_INPUT,
  ],
  'claude-sonnet-4-5-20250929': [
    ModelCapability.STREAMING,
    ModelCapability.FUNCTION_CALLING,
    ModelCapability.VISION,
    ModelCapability.THINKING,
    ModelCapability.TOOL_USE,
    ModelCapability.CONTEXT_CACHING,
    ModelCapability.STRUCTURED_OUTPUT,
    ModelCapability.PARALLEL_TOOL_CALLS,
    ModelCapability.IMAGE_INPUT,
    ModelCapability.PDF_INPUT,
  ],
  'claude-haiku-4-5-20251001': [
    ModelCapability.STREAMING,
    ModelCapability.FUNCTION_CALLING,
    ModelCapability.VISION,
    ModelCapability.THINKING,
    ModelCapability.TOOL_USE,
    ModelCapability.CONTEXT_CACHING,
    ModelCapability.STRUCTURED_OUTPUT,
    ModelCapability.PARALLEL_TOOL_CALLS,
    ModelCapability.IMAGE_INPUT,
    ModelCapability.PDF_INPUT,
  ],
  'deepseek-chat': [
    ModelCapability.STREAMING,
    ModelCapability.FUNCTION_CALLING,
    ModelCapability.TOOL_USE,
    ModelCapability.CONTEXT_CACHING,
  ],
  'deepseek-reasoner': [
    ModelCapability.STREAMING,
    ModelCapability.FUNCTION_CALLING,
    ModelCapability.THINKING,
    ModelCapability.TOOL_USE,
  ],
};

/**
 * 获取模型支持的能力列表
 */
export function getModelCapabilities(model: string): ModelCapability[] {
  const normalizedModel = Object.keys(MODEL_CAPABILITIES).find(
    (k) => model.includes(k) || k.includes(model)
  );
  if (normalizedModel) {
    return MODEL_CAPABILITIES[normalizedModel] || [];
  }
  return [ModelCapability.STREAMING];
}

/**
 * 检查模型是否支持指定能力
 */
export function modelSupportsCapability(
  model: string,
  capability: ModelCapability
): boolean {
  return getModelCapabilities(model).includes(capability);
}

/**
 * 获取支持指定能力的模型列表
 */
export function getModelsWithCapability(capability: ModelCapability): string[] {
  return Object.entries(MODEL_CAPABILITIES)
    .filter(([, caps]) => caps.includes(capability))
    .map(([model]) => model);
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
