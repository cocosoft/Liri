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
 * DeepSeek AI Provider
 *
 * 使用 ChatCompletionsTransport（OpenAI 兼容格式），
 * 通过 std/fetch 直连 API，支持流式 tool_calls 累积。
 */

import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type { ChatOptions, ProviderConfig, ProviderValidationResult, ThinkingProviderChunk } from './AIProvider';
import type { IToolExecutor, ToolRegistry } from '../interfaces/ToolExecutor';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { configManager } from '@modules/config';
import { ChatCompletionsTransport } from '../transports/ChatCompletionsTransport';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import { ALL_MODEL_CONFIGS, getModelsByProvider } from '../models/ModelConfigs';
import {
  BaseAIProvider,
  type BaseProviderOptions,
  type PendingToolCall,
} from './BaseAIProvider';

const logger = new Logger({ level: LogLevel.INFO });

const DEFAULT_BASE_URL = 'https://api.deepseek.com';

export class DeepSeekProvider extends BaseAIProvider {
  private apiKey: string;
  private baseUrl: string;

  /**
   * 初始化 DeepSeek Provider。
   * 构造函数回退链：DB 持久化 > 环境变量。
   *
   * @param options - 基础选项
   * @param _extraConfig - 扩展配置（未使用）
   */
  constructor(options: BaseProviderOptions, _extraConfig?: Record<string, unknown>) {
    super(options, _extraConfig);

    // 通过基类方法解析 API Key / Base URL
    this.apiKey = this.resolveApiKey() || '';
    this.baseUrl = (this.resolveBaseUrl() || DEFAULT_BASE_URL).replace(/\/+$/, '');

    // 初始化 Transport 适配器
    if (!this.transport) {
      this.transport = new TransportProviderAdapter(new ChatCompletionsTransport());
    }
  }

  /**
   * 运行时更新 API Key。
   *
   * @param key - 新的 API Key
   */
  override setApiKey(key: string): void {
    if (key) {
      this.apiKey = key;
      logger.info('DeepSeek API key updated');
    }
  }

  /**
   * 设置工具注册表实例。
   *
   * @param registry - 工具注册表实例，为 null 则清除
   */
  override setToolRegistry(registry: ToolRegistry | null): void {
    this.toolRegistry = registry;
  }

  /**
   * 设置工具执行器。
   *
   * @param executor - 工具执行器实例，为 null 则清除
   */
  override setToolExecutor(executor: IToolExecutor | null): void {
    this.toolExecutor = executor;
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const model = this.resolveModel('chat', options);

    const requestBody = this.transport!.buildRequest({
      model,
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.7,
    });

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AppError(
        `DeepSeek API error: ${response.status} - ${errorText}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    return this.transport!.toChatResponse(this.transport!.normalizeResponse(data));
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    const model = this.resolveModel('chat', options);

    const requestBody = this.transport!.buildRequest({
      model,
      messages,
      tools: options?.tools,
      maxTokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.7,
      stream: true,
    });

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AppError(
        `DeepSeek API error: ${response.status} - ${errorText}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (!response.body) {
      throw new AppError(
        'Response body is null',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let stopReason: 'stop' | 'tool_calls' | 'max_tokens' = 'stop';
    const pendingToolCalls: Map<number, PendingToolCall> = new Map();
    let lastUsage: ChatResponse['usage'] | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk
          .split('\n')
          .filter((line) => line.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;

            // 提取 usage 字段（通常在流式响应的最后一个 chunk 中出现）
            const usage = parsed['usage'] as ChatResponse['usage'] | undefined;
            if (usage) {
              lastUsage = usage;
            }

            const choices = parsed['choices'] as
              | Array<Record<string, unknown>>
              | undefined;
            const choice = choices?.[0];
            if (!choice) continue;

            const finishReason = choice['finish_reason'] as string | undefined;
            if (finishReason === 'tool_calls') {
              stopReason = 'tool_calls';
            } else if (finishReason === 'max_tokens') {
              stopReason = 'max_tokens';
            }

            const delta = choice['delta'] as
              | Record<string, unknown>
              | undefined;
            if (!delta) continue;

            // 处理推理内容（DeepSeek R1 的 reasoning_content 字段）
            const reasoningContent = delta?.['reasoning_content'] as string | undefined;
            if (reasoningContent) {
              yield { type: 'thinking', content: reasoningContent };
            }

            // 处理文本内容
            const content = delta?.['content'] as string | undefined;
            if (content) {
              fullContent += content;
              yield content;
            }

            // 处理流式 tool_calls（按 index 合并分片）
            const streamToolCalls = delta?.['tool_calls'] as
              | Array<Record<string, unknown>>
              | undefined;
            if (streamToolCalls) {
              for (const tc of streamToolCalls) {
                const idx = tc['index'] as number;
                let pending = pendingToolCalls.get(idx);
                if (!pending) {
                  pending = { id: '', name: '', arguments: '' };
                  pendingToolCalls.set(idx, pending);
                }
                if (tc['id']) {
                  pending.id = tc['id'] as string;
                }
                const func = tc['function'] as
                  | Record<string, unknown>
                  | undefined;
                if (func) {
                  if (func['name']) {
                    pending.name = func['name'] as string;
                  }
                  if (func['arguments']) {
                    pending.arguments += func['arguments'] as string;
                  }
                }
              }
            }
          } catch {
            // 跳过解析失败的行
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // 若 stopReason 为 tool_calls，组装 tool_calls 返回
    if (stopReason === 'tool_calls' && pendingToolCalls.size > 0) {
      const toolCalls = Array.from(pendingToolCalls.entries())
        .sort(([a], [b]) => a - b)
        .map(([_, tc]) => {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.arguments) as Record<string, unknown>;
          } catch {
            parsedArgs = { _raw: tc.arguments };
          }
          return {
            id: tc.id,
            name: tc.name,
            arguments: parsedArgs,
          };
        });
      return {
        content: fullContent,
        stop_reason: 'tool_calls',
        tool_calls: toolCalls,
        usage: lastUsage,
      };
    }

    return {
      content: fullContent,
      stop_reason: stopReason,
      usage: lastUsage,
    };
  }

  async listModels(): Promise<string[]> {
    return getModelsByProvider('deepseek').map(
      (key) => ALL_MODEL_CONFIGS[key].deepseek
    );
  }

  /**
   * 验证配置是否合法。
   *
   * @param config - Provider 配置
   * @returns 验证结果
   */
  override validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!this.apiKey && !config.apiKey && !configManager.env('DEEPSEEK_API_KEY')) {
      errors.push('API key is required (config.apiKey or DEEPSEEK_API_KEY)');
    }
    return { valid: errors.length === 0, errors, warnings };
  }
}
