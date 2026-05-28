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
 * AI 传输层统一类型定义
 * 对标 Hermes agent/transports/types.py（NormalizedResponse / ToolCall / Usage）
 */

/**
 * 标准化工具调用格式
 * 对标 Hermes ToolCall dataclass
 */
export interface NormalizedToolCall {
  /** 工具调用唯一标识 */
  id: string;
  /** 工具名称 */
  name: string;
  /** JSON 序列化的工具参数 */
  arguments: string;
}

/**
 * 标准化 Token 用量统计
 * 对标 Hermes Usage dataclass, CC Code NonNullableUsage
 */
export interface NormalizedUsage {
  /** 输入Token数 */
  inputTokens: number;
  /** 输出Token数 */
  outputTokens: number;
  /** 缓存命中Token数（prompt_cache_hit_tokens） */
  cacheReadTokens: number;
  /** 缓存写入Token数（prompt_cache_miss_tokens / cache_creation_input_tokens） */
  cacheCreationTokens: number;
  /** 总Token数 */
  totalTokens: number;
}

/**
 * 空用量常量
 */
export const EMPTY_NORMALIZED_USAGE: NormalizedUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: 0,
};

/**
 * 标准化响应格式
 * 对标 Hermes NormalizedResponse
 * 所有 Provider Transport 归一化到此类型
 */
export interface NormalizedResponse {
  /** 文本内容（不含工具调用指令） */
  content: string | null;
  /** 工具调用列表 */
  toolCalls: NormalizedToolCall[];
  /** Token 用量 */
  usage: NormalizedUsage;
  /** 思考过程（reasoning_content / reasoning） */
  reasoning: string | null;
  /** 停止原因（stop / length / tool_calls / end_turn） */
  finishReason: string;
  /** 模型名称 */
  model: string;
  /** 响应唯一标识 */
  id: string;
}

/**
 * 传输层请求参数
 * 统一的请求构建参数，各 Transport 按需转换
 */
export interface TransportRequestParams {
  /** 模型名称 */
  model: string;
  /** 内部标准消息格式 */
  messages: Array<{
    role: string;
    content: string | null;
    tool_call_id?: string;
    tool_calls?: Array<Record<string, unknown>>;
  }>;
  /** 工具定义列表 */
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  /** 系统提示 */
  systemPrompt?: string;
  /** 采样温度 */
  temperature?: number;
  /** 最大输出Token数 */
  maxTokens?: number;
  /** 是否启用流式 */
  stream?: boolean;
  /** 提供商特有扩展参数 */
  extra?: Record<string, unknown>;
}

/**
 * 传输层流式事件类型
 */
export type TransportStreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; call: NormalizedToolCall }
  | { type: 'thinking'; content: string }
  | { type: 'usage'; usage: NormalizedUsage }
  | { type: 'done'; response: NormalizedResponse }
  | { type: 'error'; error: string };
