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
import { configManager } from '@modules/config';
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

/**
 * 工具能力探测结果缓存有效期。
 * 避免每次 chat 请求都查 /props（llama-server 重启后能力可能变化，60s 足够平衡）。
 */
const TOOL_SUPPORT_CACHE_TTL_MS = 60_000;

export class LlamaCppProvider extends OpenAIProvider {
  /**
   * 工具能力探测缓存。
   * null=未探测；{supported, checkedAt}=已探测（TTL 内复用）。
   * 模型/服务端重启后 capability 可能变化，所以不能用静态字段。
   */
  private toolSupportCache: {
    supported: boolean;
    checkedAt: number;
  } | null = null;

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

  /** 本地服务可用性：探测 llama-server /health（根路径，baseUrl 的 /v1 后缀需剥离） */
  async isAvailable(): Promise<boolean> {
    try {
      const origin = this.baseUrl.replace(/\/v1$/, '');
      const res = await fetch(`${origin}/health`, {
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
   * 命名与 model_registry 注册一致：modelId 不含 .gguf 扩展名
   */
  override async listModels(): Promise<string[]> {
    const { llamaCppServerManager } =
      await import('../local/llama/LlamaCppServerManager.js');
    const ggufModels = llamaCppServerManager
      .scanModels()
      .map((p) => (p.split(/[\\/]/).pop() || p).replace(/\.gguf$/i, ''));
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
   * 本地推理超时（毫秒）。
   * 14B Q4_K_M 模型在纯 CPU 上约 3.8 tokens/s，生成 1000 tokens 需要 ~260s。
   * 云端默认 300s 对本地不够，提升到 600s（10 分钟）。
   * 环境变量 AI_MODEL_TIMEOUT_MS 若显式设置则优先（用户可强制覆盖）。
   */
  protected override resolveRequestTimeoutMs(): number {
    const raw = configManager.env('AI_MODEL_TIMEOUT_MS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 600_000;
  }

  /**
   * 探测 llama-server 当前模型是否支持工具调用。
   * llama.cpp 的 /props 返回 chat_template_caps.supports_tools/supports_tool_calls，
   * 不少 GGUF 模型（如 DeepSeek-R1-Distill）不支持工具调用。
   * 若强行发送 tools 字段，模型会忽略并返回空 content，
   * Liri 的 ReAct 循环会反复重试直到熔断。
   * 缓存 TTL=60s，避免每次请求都查 /props。
   */
  async probeToolSupport(): Promise<boolean> {
    // TTL 内复用缓存
    if (
      this.toolSupportCache &&
      Date.now() - this.toolSupportCache.checkedAt < TOOL_SUPPORT_CACHE_TTL_MS
    ) {
      return this.toolSupportCache.supported;
    }

    try {
      const origin = this.baseUrl.replace(/\/v1$/, '');
      const res = await fetch(`${origin}/props`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        // 探测失败时保守返回 true（不阻断工具调用，由服务端自行处理）
        this.toolSupportCache = { supported: true, checkedAt: Date.now() };
        return true;
      }
      const data = (await res.json()) as {
        chat_template_caps?: {
          supports_tools?: boolean;
          supports_tool_calls?: boolean;
        };
      };
      const caps = data.chat_template_caps;
      // 两个能力都为 true 才认为支持工具调用
      const supported =
        caps?.supports_tools === true && caps?.supports_tool_calls === true;
      this.toolSupportCache = { supported, checkedAt: Date.now() };
      if (!supported) {
        logger.warn(
          'llama-server 当前模型不支持工具调用（chat_template_caps.supports_tools=false），本次请求将不带 tools 字段'
        );
      }
      return supported;
    } catch (err) {
      // 探测异常时保守返回 true（不阻断主流程）
      logger.debug('探测 llama-server 工具能力失败，保守按支持处理', {
        error: String(err),
      });
      this.toolSupportCache = { supported: true, checkedAt: Date.now() };
      return true;
    }
  }

  /**
   * 静态探测模型能力（供统一能力探测模块调用）：
   *  - tool_use: 复用 probeToolSupport（/props chat_template_caps，带 60s 缓存）
   *  - vision: llama-server /props 未直接暴露视觉元数据，保守返回 unknown
   * model 参数仅用于保持接口一致（llama.cpp 一次加载一个模型，能力由服务端决定）。
   */
  async probeCapabilities(_model: string): Promise<{
    tool_use: boolean | 'unknown';
    vision: boolean | 'unknown';
  }> {
    const supported = await this.probeToolSupport();
    return { tool_use: supported, vision: 'unknown' };
  }

  /**
   * 工具定义数量兜底 + 能力探测：
   * 1. 探测模型是否支持工具调用，不支持则整体丢弃 tools（避免 ReAct 死循环）
   * 2. 支持时截断到 MAX_TOOLS_PER_REQUEST（避免小窗口 context 溢出）
   */
  private async limitTools(
    tools?: ToolDefinition[]
  ): Promise<ToolDefinition[] | undefined> {
    if (!tools || tools.length === 0) return tools;

    // 能力探测：不支持工具调用则整体丢弃
    const supported = await this.probeToolSupport();
    if (!supported) {
      logger.warn(
        `llama: 模型不支持工具调用，本次请求丢弃 ${tools.length} 个工具定义`
      );
      return undefined;
    }

    // 数量兜底：截断到上限
    if (tools.length <= MAX_TOOLS_PER_REQUEST) return tools;
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
    const limitedTools = await this.limitTools(options?.tools);
    return BaseAIProvider.measureChat('LlamaCpp', () =>
      super.chat(messages, {
        ...options,
        tools: limitedTools,
      })
    );
  }

  override async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    const limitedTools = await this.limitTools(options?.tools);
    return yield* super.chatStream(messages, {
      ...options,
      tools: limitedTools,
    });
  }
}
