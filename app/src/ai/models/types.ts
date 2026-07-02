// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * AI模型类型定义（整合llm/types.ts）
 */

export enum AIModelType {
  CLAUDE_3_HAIKU = 'claude-3-haiku-20240307',
  CLAUDE_3_SONNET = 'claude-3-sonnet-20240229',
  CLAUDE_3_OPUS = 'claude-3-opus-20240229',
  GPT_3_5_TURBO = 'gpt-3.5-turbo',
  GPT_4 = 'gpt-4',
  GPT_4_TURBO = 'gpt-4-turbo',
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
  IMAGE_GENERATION = 'image_generation',
  VIDEO_GENERATION = 'video_generation',
  PDF_INPUT = 'pdf_input',
  CODE_EXECUTION = 'code_execution',
  EMBEDDING = 'embedding',
  TEXT_TO_SPEECH = 'text_to_speech',
  SPEECH_RECOGNITION = 'speech_recognition',
  RERANKING = 'reranking',
  MODERATION = 'moderation',
  AUDIO_INPUT = 'audio_input',
  VIDEO_INPUT = 'video_input',
  IMAGE_EDITING = 'image_editing',
}

// 模型能力函数已迁移到 ModelConfigs.ts，请直接引用

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
  defaultModel: string;
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface AIService {
  generate(
    messages: AIMessage[],
    model?: string,
    options?: Partial<AIRequestParams>
  ): Promise<AIResponse>;
  stream(
    messages: AIMessage[],
    model?: string,
    options?: Partial<AIRequestParams>
  ): AsyncGenerator<AIResponse>;
  setDefaultModel(model: string): void;
  getDefaultModel(): string;
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

/**
 * 文本内容片段（多模态）
 */
export interface TextContentPart {
  type: 'text';
  text: string;
}

/**
 * 图片内容片段（多模态）
 * 支持 URL 引用或 Base64 内联
 */
export interface ImageContentPart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

/**
 * 多模态内容片段联合类型
 */
export type ContentPart = TextContentPart | ImageContentPart;

/**
 * @deprecated 使用 {@link DataMessage} — 从 `@modules/core/data-models` 导入
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** 纯文本内容（向后兼容） */
  content: string;
  /** 多模态内容（可选）：存在时优先于 content */
  multimodal?: ContentPart[];
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
    parameters: Record<string, unknown>;
  };
}

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
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

/**
 * 将图片文件路径/Buffer 转为 ImageContentPart
 * 支持 URL、文件路径、Buffer 三种输入
 */
export function imageToContentPart(
  input: string | Buffer,
  detail?: 'auto' | 'low' | 'high'
): ImageContentPart {
  if (typeof input === 'string') {
    if (
      input.startsWith('http://') ||
      input.startsWith('https://') ||
      input.startsWith('data:')
    ) {
      return { type: 'image_url', image_url: { url: input, detail } };
    }

    const fs = require('node:fs');
    const buffer = fs.readFileSync(input);
    const ext = input.split('.').pop()?.toLowerCase() || 'png';
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      bmp: 'image/bmp',
    };
    const mime = mimeMap[ext] || 'image/png';

    return {
      type: 'image_url',
      image_url: {
        url: `data:${mime};base64,${buffer.toString('base64')}`,
        detail,
      },
    };
  }

  return {
    type: 'image_url',
    image_url: {
      url: `data:image/png;base64,${input.toString('base64')}`,
      detail,
    },
  };
}
