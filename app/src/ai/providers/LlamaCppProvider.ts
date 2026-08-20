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
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
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
 * llama.cpp 单次输出词元上限（2026-08-20 用户决策：2048 封顶防卡死）。
 * 纯 CPU 跑 27B 模型生成速度仅 ~1-4 词元/秒：4096 默认值需 17~68 分钟，
 * 输出截断重试翻倍到 8192 更是数小时（日志实证 n_predict=8192 剩余 7805 排队）。
 * 此处封顶同时拦住两条路径：上游默认 4096 与 streamMessageFlow 重试翻倍。
 * 云端 Provider 不受影响（速度快，无需封顶）。
 */
const MAX_OUTPUT_TOKENS = 2048;

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
   * 本地模型首 token 通常在 10-60s，整体生成 5 分钟足够。
   * 设 300s 为默认值（而非 600s）——配合 streamMessageFlow 的 TTFB 硬超时（300s），
   * 形成双重保护：首 token 超时由 streamMessageFlow 兜底，整体生成超时由此处兜底。
   * 环境变量 AI_MODEL_TIMEOUT_MS 若显式设置则优先（用户可强制覆盖）。
   */
  protected override resolveRequestTimeoutMs(): number {
    const raw = configManager.env('AI_MODEL_TIMEOUT_MS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
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
    await this.preFetchHealthCheck();
    const limitedTools = await this.limitTools(options?.tools);
    return BaseAIProvider.measureChat('LlamaCpp', () =>
      super.chat(messages, {
        ...options,
        ...this.clampMaxTokens(options),
        tools: limitedTools,
      })
    );
  }

  /**
   * 输出词元封顶：maxTokens 不超过 MAX_OUTPUT_TOKENS（2048）。
   * 未传时同样注入 2048——父类 OpenAIProvider 默认 4096，对纯 CPU 本地推理过大。
   */
  private clampMaxTokens(options?: ChatOptions): { maxTokens: number } {
    const requested = options?.maxTokens;
    if (requested !== undefined && requested <= MAX_OUTPUT_TOKENS) {
      return { maxTokens: requested };
    }
    if (requested !== undefined) {
      logger.info('llama.cpp 输出词元封顶', {
        requestedMaxTokens: requested,
        cappedTo: MAX_OUTPUT_TOKENS,
        reason: `纯 CPU 生效速度 ~1-4 词元/秒，防止单次回复耗时过长导致排队卡死`,
      });
    }
    return { maxTokens: MAX_OUTPUT_TOKENS };
  }

  /**
   * 发送请求前检查 llama-server 健康状态。
   * 若服务未运行或已卡在处理中，直接返回错误而非等待超时。
   * 检查 /health（服务存活）和 /slots（是否已有任务占用）。
   */
  private async preFetchHealthCheck(): Promise<void> {
    const checkStart = Date.now();
    const origin = this.baseUrl.replace(/\/v1$/, '');
    logger.info('llama-server 健康检查开始', {
      baseUrl: this.baseUrl,
      origin,
      requestId: `hc-${checkStart}`,
    });

    try {
      // Step 1: /health 健康检查
      const healthStart = Date.now();
      const healthCtrl = new AbortController();
      const healthTimer = setTimeout(() => {
        logger.warn('llama-server /health 请求超时', {
          timeoutMs: 5000,
          elapsedMs: Date.now() - healthStart,
        });
        healthCtrl.abort();
      }, 5000);

      let healthRes: Response;
      try {
        healthRes = await fetch(`${origin}/health`, {
          signal: healthCtrl.signal,
        });
      } catch (fetchErr) {
        clearTimeout(healthTimer);
        const elapsedMs = Date.now() - healthStart;
        const msg =
          fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        logger.error('llama-server /health 请求失败', {
          error: msg,
          elapsedMs,
          errorName: fetchErr instanceof Error ? fetchErr.name : undefined,
          errorStack:
            fetchErr instanceof Error
              ? fetchErr.stack?.slice(0, 200)
              : undefined,
        });
        throw fetchErr;
      }
      clearTimeout(healthTimer);

      const healthElapsedMs = Date.now() - healthStart;
      const healthOk = healthRes.ok;
      logger.info('llama-server /health 检查完成', {
        status: healthRes.status,
        ok: healthOk,
        elapsedMs: healthElapsedMs,
      });

      if (!healthOk) {
        logger.warn('llama-server /health 返回非 200，跳过 slots 检查', {
          status: healthRes.status,
          elapsedMs: healthElapsedMs,
          reason: '服务可能未就绪',
        });
        logger.info('llama-server 健康检查结束', {
          totalElapsedMs: Date.now() - checkStart,
          result: 'health_check_failed',
        });
        return;
      }

      // Step 2: /slots 状态检查
      const slotStart = Date.now();
      const slotCtrl = new AbortController();
      const slotTimer = setTimeout(() => {
        logger.warn('llama-server /slots 请求超时', {
          timeoutMs: 5000,
          elapsedMs: Date.now() - slotStart,
        });
        slotCtrl.abort();
      }, 5000);

      let slotRes: Response;
      try {
        slotRes = await fetch(`${origin}/slots`, {
          signal: slotCtrl.signal,
        });
      } catch (fetchErr) {
        clearTimeout(slotTimer);
        const elapsedMs = Date.now() - slotStart;
        const msg =
          fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        logger.error('llama-server /slots 请求失败', {
          error: msg,
          elapsedMs,
          errorName: fetchErr instanceof Error ? fetchErr.name : undefined,
          errorStack:
            fetchErr instanceof Error
              ? fetchErr.stack?.slice(0, 200)
              : undefined,
        });
        throw fetchErr;
      }
      clearTimeout(slotTimer);

      const slotElapsedMs = Date.now() - slotStart;
      const slotOk = slotRes.ok;
      logger.info('llama-server /slots 请求完成', {
        status: slotRes.status,
        ok: slotOk,
        elapsedMs: slotElapsedMs,
      });

      if (!slotOk) {
        logger.info('llama-server 健康检查结束', {
          totalElapsedMs: Date.now() - checkStart,
          result: 'slots_check_non_ok',
          slotStatus: slotRes.status,
        });
        return;
      }

      // Step 3: 解析 slots 数据（llama-server 返回数组）
      const rawSlots = (await slotRes.json()) as unknown;
      const slots = Array.isArray(rawSlots) ? rawSlots : [];
      const totalSlots = slots.length;

      // 遍历所有 slot，检查是否有正在处理的任务
      // 生成进度位于 next_token[0]（n_deccoded=已生成 / n_remain=剩余）
      const processingSlots: Array<{
        id: number;
        nPromptTokens: number;
        nPromptProcessed: number;
        nDecoded: number;
        nRemain: number;
        nPredict: number;
      }> = [];

      for (const slot of slots) {
        const s = slot as {
          id: number;
          is_processing?: boolean;
          n_prompt_tokens?: number;
          n_prompt_tokens_processed?: number;
          next_token?: Array<{ n_remain?: number; n_decoded?: number }>;
          params?: { n_predict?: number };
        };
        if (s.is_processing) {
          processingSlots.push({
            id: s.id,
            nPromptTokens: s.n_prompt_tokens ?? 0,
            nPromptProcessed: s.n_prompt_tokens_processed ?? 0,
            nDecoded: s.next_token?.[0]?.n_decoded ?? 0,
            nRemain: s.next_token?.[0]?.n_remain ?? 0,
            nPredict: s.params?.n_predict ?? 0,
          });
        }
      }

      const slotInfo = slots.map((s) => {
        const slot = s as {
          id: number;
          is_processing?: boolean;
          n_ctx?: number;
          n_prompt_tokens?: number;
          n_tokens_predicted?: number;
        };
        return {
          id: slot.id,
          isProcessing: slot.is_processing ?? false,
          nCtx: slot.n_ctx ?? 0,
          nPromptTokens: slot.n_prompt_tokens ?? 0,
          nTokensPredicted: slot.n_tokens_predicted ?? 0,
        };
      });

      logger.info('llama-server /slots 数据解析完成', {
        totalSlots,
        processingCount: processingSlots.length,
        slots: slotInfo,
        elapsedMs: slotElapsedMs,
      });

      const isBusy = processingSlots.length > 0;

      // busy 时直接拒绝请求（2026-08-20 根因修复）：
      // llama-server 单 slot 被长任务占用时，新请求会进入队列排队。
      // 纯 CPU 跑大模型生成 n_predict=8192 需要数十分钟，排队必然触发
      // TTFB 300s 超时（日志实证：elapsedMs=300095 + LLM_TTFB_TIMEOUT）。
      // 明确拒绝并提示用户，比让请求排队等死更友好。
      if (isBusy) {
        const ps = processingSlots[0];
        // CPU 生成速度按 1~4 tokens/s 估算剩余时间（下限口径，保守提示）
        const estRemainingSec = ps.nRemain > 0 ? Math.round(ps.nRemain / 2) : 0;
        const estText =
          estRemainingSec > 0
            ? `预计还需约 ${Math.max(1, Math.round(estRemainingSec / 60))} 分钟以上（纯 CPU 速度约 1~4 词元/秒）`
            : '剩余时间无法预估（纯 CPU 速度约 1~4 词元/秒）';

        logger.warn('llama-server 正在处理任务，拒绝新请求', {
          slotId: ps.id,
          promptTokens: ps.nPromptTokens,
          promptProcessed: ps.nPromptProcessed,
          decoded: ps.nDecoded,
          remain: ps.nRemain,
          nPredict: ps.nPredict,
          processingCount: processingSlots.length,
        });

        throw new AppError(
          `本地模型正在处理上一个回复（已生成 ${ps.nDecoded} 个词元，剩余 ${ps.nRemain} 个，${estText}），为避免本次请求排队超时已直接取消。建议：等上一条回复完成后再发新消息；若上一条已不需要，可到「设置 → llama.cpp 本地推理」点击「强制重启」清理积压任务。`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.MEDIUM,
          'LLAMA_SERVER_BUSY'
        );
      }

      logger.info('llama-server 健康检查结束', {
        totalElapsedMs: Date.now() - checkStart,
        result: 'ready',
        totalSlots,
        processingCount: 0,
        isBusy: false,
      });
    } catch (e) {
      // LLAMA_SERVER_BUSY 必须穿透（不能被健康检查的容错逻辑吞掉）
      if (e instanceof AppError && e.code === 'LLAMA_SERVER_BUSY') {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      const elapsedMs = Date.now() - checkStart;
      logger.warn('llama-server 健康检查异常（将继续尝试请求）', {
        error: msg,
        elapsedMs,
        errorName: e instanceof Error ? e.name : undefined,
        errorStack: e instanceof Error ? e.stack?.slice(0, 300) : undefined,
        note: '健康检查失败不阻断主请求流程，主请求会有独立超时保护',
      });
    }
  }

  override async *chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    await this.preFetchHealthCheck();
    const limitedTools = await this.limitTools(options?.tools);
    return yield* super.chatStream(messages, {
      ...options,
      ...this.clampMaxTokens(options),
      tools: limitedTools,
    });
  }
}
