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
 * LlamaCppProvider — llama.cpp (Local) 推理供应商
 *
 * llama.cpp server 提供 OpenAI 兼容 /v1/chat/completions，故继承 OpenAIProvider
 * 复用 ChatCompletionsTransport 与完整 OpenAI 兼容实现；仅覆盖本地特有语义：
 *  - 可用性探测走 /health（而非 OpenAI /models 鉴权）
 *  - 模型列表优先返回本地 GGUF 文件（ServerManager.scanModels）
 *  - 本地服务无需 API Key（validateConfig 不要求）
 */

import { getLogger } from '@modules/monitoring';
import { BaseAIProvider } from './BaseAIProvider';
import { OpenAIProvider } from './OpenAIProvider';
import type { ProviderConfig, ProviderValidationResult } from './AIProvider';
import type {
  ChatOptions,
  ChatMessage,
  ChatResponse,
  ThinkingProviderChunk,
  ToolDefinition,
} from '@modules/ai';

const logger = getLogger('ai:llama');

/** llama-server 默认 OpenAI 兼容端点（与 LlamaCppServerManager 默认端口对齐） */
const DEFAULT_BASE_URL = 'http://127.0.0.1:11435/v1';

/**
 * llama.cpp 单次请求工具数量上限。
 * llama.cpp 的 chat template 会把全部工具 schema 渲染进 prompt（实测每工具 ~180 tokens），
 * 54 个工具 ≈ 9.6K tokens，小窗口（4096/8192）下直接 context 溢出（15903 > 8192 400）。
 * 发送前保护（applyPreSendProtection）在超预算时整体移除工具，此处做数量兜底：
 * 工具多但预算未触发时仍截断到上限，保留核心工具可用。
 */
const MAX_TOOLS_PER_REQUEST = 20;

export class LlamaCppProvider extends OpenAIProvider {
  /**
   * @param options - 基础选项（providerId, displayName, defaultBaseUrl 等）
   * @param _extraConfig - 扩展配置（保留接口一致）
   */
  constructor(
    options: import('./BaseAIProvider').BaseProviderOptions,
    _extraConfig?: Record<string, unknown>
  ) {
    super(options, _extraConfig);
    this.baseUrl = (this.resolveBaseUrl() || DEFAULT_BASE_URL).replace(
      /\/+$/,
      ''
    );
  }

  /** 本地服务可用性：探测 llama-server /health */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch (err) {
      return false;
    }
  }

  /**
   * 模型列表：优先 GGUF 目录扫描（本地文件为准），
   * 其次 llama-server /models（OpenAI 兼容）兜底
   */
  override async listModels(): Promise<string[]> {
    const { llamaCppServerManager } =
      await import('../local/llama/LlamaCppServerManager.js');
    const ggufModels = llamaCppServerManager
      .scanModels()
      .map((p) => p.split(/[\\/]/).pop() || p);
    if (ggufModels.length > 0) return ggufModels;

    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: { id: string }[] };
      return (data.data || []).map((m) => m.id);
    } catch (err) {
      logger.debug('llama-server /models 查询失败，返回空列表', {
        error: String(err),
      });
      return [];
    }
  }

  /** 本地服务无需 API Key；仅校验 baseUrl 可达性 */
  override validateConfig(config: ProviderConfig): ProviderValidationResult {
    const warnings: string[] = [];
    if (!config.baseUrl) {
      warnings.push(
        'No baseUrl configured, using default: ' + DEFAULT_BASE_URL
      );
    }
    return { valid: true, errors: [], warnings };
  }

  /**
   * 工具定义数量兜底：截断到 MAX_TOOLS_PER_REQUEST。
   * llama.cpp chat template 会把工具 schema 全部渲染进 prompt，
   * 超限时移除尾部工具（保留靠前的核心工具），避免小窗口 context 溢出。
   */
  private limitTools(tools?: ToolDefinition[]): ToolDefinition[] | undefined {
    if (!tools || tools.length <= MAX_TOOLS_PER_REQUEST) return tools;
    const kept = tools.slice(0, MAX_TOOLS_PER_REQUEST);
    const removed = tools
      .slice(MAX_TOOLS_PER_REQUEST)
      .map((t) => t.function.name);
    logger.warn('llama: 工具数量超限，已截断（发送前兜底）', {
      total: tools.length,
      kept: kept.length,
      removedTools: removed,
    });
    return kept;
  }

  override async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    // 耗时统计：委托 BaseAIProvider.measureChat（2026-08-16）
    return BaseAIProvider.measureChat('LlamaCpp', () =>
      super.chat(messages, {
        ...options,
        tools: this.limitTools(options?.tools),
      })
    );
  }

  override async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    return yield* super.chatStream(messages, {
      ...options,
      tools: this.limitTools(options?.tools),
    });
  }
}
