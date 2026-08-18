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
 * BaseAIProvider — AI Provider 抽象基类
 *
 * 所有 Provider 必须继承此类，统一管理：
 * - 模型解析（通过 ModelRouter）
 * - API Key / Base URL 解析（DB → env 两层回退）
 * - Transport 适配器
 * - SSE 流式解析（三种格式：openai / anthropic / google）
 * - 重试机制（withRetry + 指数退避）
 * - 工具注册 & 执行器
 * - HTTP 错误处理
 */

import type {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../models/types';
import type {
  AIProvider,
  ChatOptions,
  ProviderCapabilities,
  ProviderConfig,
  ProviderValidationResult,
  ThinkingProviderChunk,
} from './AIProvider';
import type { IToolExecutor, ToolRegistry } from '../interfaces/ToolExecutor';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { resolveModelRoute, RouteKey } from '../router/resolveModelRoute.js';
import type { RouteKey as RouteKeyType } from '../router/routes.js';
import type { TaskType } from '../modelRouter';
import { ModelRegistry } from '../models/ModelRegistry';
import type { APIProvider } from '../models/ModelConfigs';
import { TransportProviderAdapter } from '../transports/TransportProviderAdapter';
import type { TransportStreamEvent } from '../transports/types';
import { configManager } from '@modules/config';
import { repairModelJson } from '@modules/utils/json';
import { getCACertificates, findCACertFilePath } from '@modules/utils/caCerts';

const logger = getLogger('ai:baseProvider');

/**
 * readStreamChunkWithTimeout 的流读取诊断状态（按 reader 隔离，
 * 避免同一 provider 实例并发流时状态交叉）
 */
const streamReadState = new WeakMap<
  ReadableStreamDefaultReader<Uint8Array>,
  {
    chunkCount: number;
    lastChunkAt: number;
    startedAt: number;
    /** 最近一块与上一块的间隔（ms），排查"是否有数据但极慢"与"完全挂起"的差异 */
    lastIntervalMs: number;
    /** 当前轮 read 的连续无数据超时次数（读回数据即清零） */
    strikes: number;
  }
>();

/** TaskType → RouteKey 映射，用于 resolveModel 中的任务类型路由 */
const TASK_TO_ROUTE: Record<string, RouteKeyType> = {
  chat: RouteKey.CHAT,
  agent: RouteKey.AGENT,
  scheduled: RouteKey.SCHEDULED,
  coding: RouteKey.CODING,
  translation: RouteKey.TRANSLATION,
};

// ============================================================
// SSE 格式枚举
// ============================================================

/** SSE 流式响应格式类型 */
export enum SSEFormat {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GOOGLE = 'google',
}

// ============================================================
// BaseProviderOptions
// ============================================================

/** Provider 构造选项（替代旧的 ProviderConfig 首参） */
export interface BaseProviderOptions {
  /** Provider 唯一标识 */
  providerId: string;
  /** 显示名称 */
  displayName: string;
  /** 默认 Base URL */
  defaultBaseUrl?: string;
  /** 环境变量 API Key 名称（如 'DEEPSEEK_API_KEY'） */
  envApiKey?: string;
  /** Transport 适配器 */
  transport?: TransportProviderAdapter;
  /** 默认解析的 TaskType */
  defaultTaskType?: TaskType;
  /** 默认模型 ID（resolveModel 回退链最高优先级） */
  defaultModel?: string;
}

// ============================================================
// PendingToolCall（流式 tool_calls 分片累积）
// ============================================================

/** 流式 tool_calls 分片累积中间状态 */
export interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

// ============================================================
// 重试配置
// ============================================================

/** 指数退避重试配置 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

// ============================================================
// BaseAIProvider（抽象类）
// ============================================================

/**
 * AI Provider 抽象基类
 *
 * 子类必须实现：
 * - chat()
 * - chatStream()
 * - listModels()
 *
 * 按需覆盖：
 * - supportsThinking()
 * - supportsStructuredOutputs()
 * - generateImage()
 * - analyzeImage()
 */
export abstract class BaseAIProvider implements AIProvider {
  readonly id: string;
  readonly displayName: string;

  /** 构造选项（只读，子类可通过 this.options 访问） */
  protected readonly options: BaseProviderOptions;

  /** Transport 适配器实例 */
  protected transport: TransportProviderAdapter | null;

  /** 工具注册表 */
  protected toolRegistry: ToolRegistry | null = null;

  /** 工具执行器 */
  protected toolExecutor: IToolExecutor | null = null;

  /** Provider 能力声明（子类在构造函数中设置） */
  public capabilities: ProviderCapabilities = {};

  /** 连续 529 错误计数（用于指数退避） */
  protected consecutive529Errors: number = 0;

  /** 重试配置 */
  protected retryConfig: RetryConfig;

  // ============================================================
  // 构造函数
  // ============================================================

  /**
   * 初始化 Provider 实例。
   * 构造函数回退链：DB 持久化 > 环境变量（两层，无 config 层）。
   *
   * @param options - 基础选项（providerId, displayName, defaultBaseUrl, envApiKey 等）
   * @param _extraConfig - 子类特有扩展配置（可选）
   */
  constructor(
    options: BaseProviderOptions,
    _extraConfig?: Record<string, unknown>
  ) {
    this.id = options.providerId;
    this.displayName = options.displayName;
    this.options = options;
    this.transport = options.transport || null;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG };
  }

  // ============================================================
  // 模型解析
  // ============================================================

  /**
   * 解析当前使用的模型名。
   *
   * 优先级：
   *   1. ChatOptions.model
   *   2. options.defaultModel（构造函数传入）
   *   3. ModelRouter.resolveMapped(taskType, providerId)
   *   4. ModelRouter.resolve('chat')
   *
   * 若全部为空，抛 AppError（拒绝静默空值）。
   *
   * @param taskType - 任务类型（可选，用于 ModelRouter 路由）
   * @param options - 本次调用的 ChatOptions
   * @returns 模型名（非空）
   */
  async resolveModel(
    taskType?: TaskType,
    options?: ChatOptions
  ): Promise<string> {
    // 1. ChatOptions 中的 model 优先
    if (options?.model) return options.model;

    // 2. 构造函数默认模型
    if (this.options.defaultModel) return this.options.defaultModel;

    // 3. 统一模型路由：带任务类型解析
    if (taskType) {
      const route = TASK_TO_ROUTE[taskType] ?? RouteKey.CHAT;
      const mapped = await resolveModelRoute(route);
      if (mapped) return mapped;
    }

    // 4. 再试一次无 taskType 的 chat 路由
    const model = await resolveModelRoute(RouteKey.CHAT);
    if (model) return model;

    throw new AppError(
      `无法解析模型: Provider ${this.id} 未配置模型`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1001'
    );
  }

  // ============================================================
  // API Key 解析（DB → env 两层回退）
  // ============================================================

  /**
   * 解析 API Key。
   *
   * 回退链：DB 持久化（ModelRegistry） > 环境变量。
   *
   * @returns API Key 或 undefined
   */
  protected resolveApiKey(): string | undefined {
    // 1. 先从 DB（ModelRegistry）读取
    try {
      const registry = ModelRegistry.getInstance();
      const providerConfig = registry.getProviderConfig(this.id as APIProvider);
      if (providerConfig?.apiKey) return providerConfig.apiKey;
    } catch (err) {
      // 忽略异常，回退到环境变量
    }

    // 2. 环境变量回退
    if (this.options.envApiKey) {
      const envKey = configManager.env(this.options.envApiKey);
      if (envKey) return envKey;
    }

    return undefined;
  }

  // ============================================================
  // Base URL 解析（DB → options 两层回退）
  // ============================================================

  /**
   * 解析 Base URL。
   *
   * 回退链：DB 持久化（ModelRegistry） > options.defaultBaseUrl。
   *
   * @returns Base URL 或 undefined
   */
  protected resolveBaseUrl(): string | undefined {
    try {
      const registry = ModelRegistry.getInstance();
      const providerConfig = registry.getProviderConfig(this.id as APIProvider);
      if (providerConfig?.baseUrl) return providerConfig.baseUrl;
    } catch (err) {
      // 忽略异常
    }

    return this.options.defaultBaseUrl;
  }

  // ============================================================
  // 重试机制
  // ============================================================

  /**
   * 判断 HTTP 状态码是否需要退避重试。
   *
   * @param status - HTTP 状态码
   * @returns 是否应退避
   */
  shouldBackOff(status: number): boolean {
    return status === 529 || status === 429;
  }

  /**
   * 带指数退避的异步重试。
   *
   * 对 529/429 状态码自动退避重试，延迟时间随尝试次数和连续 529 计数增长。
   * 非退避错误直接抛出，不重试。
   *
   * @param fn - 需要重试的异步函数
   * @param config - 可选的重试配置覆盖
   * @returns 函数的返回值
   */
  async withRetry<T>(
    fn: () => Promise<T>,
    config?: Partial<RetryConfig>
  ): Promise<T> {
    const cfg = { ...this.retryConfig, ...config };
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: unknown) {
        lastError = error as Error;

        if (attempt >= cfg.maxRetries) break;

        const err = error as Record<string, unknown>;
        const status = (err?.status || err?.statusCode || 0) as number;
        if (!this.shouldBackOff(status)) {
          // 非退避错误，直接抛出
          throw error;
        }

        if (status === 529) {
          this.consecutive529Errors++;
        }

        const delay = Math.min(
          cfg.baseDelayMs * Math.pow(2, attempt + this.consecutive529Errors),
          cfg.maxDelayMs
        );

        logger.warning(
          `重试 ${this.id} 请求 (attempt ${attempt + 1}/${cfg.maxRetries})`,
          { status, delayMs: delay }
        );

        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  // ============================================================
  // CA 证书 dispatcher（解决 Windows 环境下 SSL 证书验证失败问题）
  // ============================================================

  /** 缓存的自定义 undici Agent dispatcher（已注入系统 CA 证书） */
  private static _caDispatcher: import('undici').Agent | undefined | null =
    null;

  /**
   * 缓存的自定义 CA 证书文件路径（供 Bun fetch 的 tls.ca 注入）。
   * null 表示已查找过但未找到（避免重复 IO）；string 为找到的证书路径。
   */
  private static _caCertFilePath: string | null | undefined = undefined;

  /**
   * 获取带有系统 CA 证书的 undici fetch dispatcher。
   *
   * 优先从 NODE_EXTRA_CA_CERTS 环境变量读取，其次从系统默认 CA 路径读取。
   * 仅在成功加载 CA 证书时返回 Agent，否则返回 undefined（使用默认行为）。
   *
   * 注意：undici 仅在 Node.js 18+ 环境中可用（Bun 等其他运行时可能没有）。
   *
   * @returns undici Agent dispatcher，或 undefined（使用默认 fetch）
   */
  private static getFetchDispatcher(): import('undici').Agent | undefined {
    if (BaseAIProvider._caDispatcher !== null) {
      return BaseAIProvider._caDispatcher;
    }

    try {
      const caCerts = getCACertificates();
      if (caCerts && caCerts.length > 0) {
        // 动态导入 undici（Node.js 18+ 内置，Bun 等其他运行时不可用）

        const { Agent } = require('undici') as typeof import('undici');

        BaseAIProvider._caDispatcher = new Agent({
          connect: {
            ca: caCerts,
          },
        });

        logger.info('BaseAIProvider · 已加载系统 CA 证书 dispatcher', {
          certCount: caCerts.length,
        });

        return BaseAIProvider._caDispatcher;
      }
    } catch (err) {
      // undici 不可用或 CA 加载失败，回退到默认证书行为（不注入 dispatcher）
    }

    BaseAIProvider._caDispatcher = undefined;
    return undefined;
  }

  /**
   * 将 CA 证书注入到 RequestInit 中，兼容两种运行时：
   * - Node.js：通过 undici `dispatcher` 注入 Agent（`connect.ca` 接受 PEM 字符串）
   * - Bun：通过原生 `tls.ca` 选项注入（`Bun.file()` 路径形式，Bun 1.0+ 支持）
   *
   * 不会修改传入的 init 对象，返回新对象或原对象。
   * 两种注入方式互不冲突——Bun 忽略 dispatcher，Node 忽略 tls.ca。
   *
   * @param init - 原始 RequestInit
   * @returns 注入了 CA 证书的 RequestInit
   */
  private static injectCADispatcher(init?: RequestInit): RequestInit {
    const result = { ...(init ?? {}) } as RequestInit;

    // 1. undici dispatcher 注入（Node.js）
    const dispatcher = BaseAIProvider.getFetchDispatcher();
    if (dispatcher) {
      (result as Record<string, unknown>).dispatcher = dispatcher;
    }

    // 2. Bun 原生 tls.ca 注入
    const tlsCA = BaseAIProvider.getBunTlsCA();
    if (tlsCA) {
      (result as Record<string, unknown>).tls = tlsCA;
    }

    return result;
  }

  /**
   * 获取 Bun 原生 fetch 的 tls.ca 配置（仅 Bun 运行时生效）。
   *
   * Bun 的 fetch 使用 BoringSSL 作为 TLS 栈，与 Node.js 的 OpenSSL 共享
   * 不同的 CA 信任列表。通过 `tls: { ca: [Bun.file(path)] }` 可将系统 CA
   * 证书注入到 Bun 的 TLS 验证中，解决 "unknown certificate verification error"
   * 等 SSL 验证失败问题（2026-08-17）。
   *
   * @returns `{ ca: [BunFile] }` 或 undefined（非 Bun 运行时 / 未找到 CA 证书）
   */
  private static getBunTlsCA(): { ca: unknown[] } | undefined {
    // 非 Bun 运行时直接返回
    if (typeof Bun === 'undefined' || typeof Bun.file !== 'function') {
      return undefined;
    }

    // 首次查找后缓存结果（避免重复 IO）
    if (BaseAIProvider._caCertFilePath === undefined) {
      BaseAIProvider._caCertFilePath = findCACertFilePath() ?? null;
    }

    if (!BaseAIProvider._caCertFilePath) {
      return undefined;
    }

    logger.info('BaseAIProvider · 已注入 Bun 原生 tls.ca 证书', {
      path: BaseAIProvider._caCertFilePath,
    });

    return { ca: [Bun.file(BaseAIProvider._caCertFilePath)] };
  }

  // ============================================================
  // 带连接重试的 fetch
  // ============================================================

  /**
   * 提取 fetch 底层连接错误信息，兼容两种运行时错误结构（2026-08-17）：
   * - undici/Node：`TypeError("Was there a typo in the url or port?")`，真实原因在
   *   `error.cause.code`（ENOTFOUND/ECONNREFUSED/EAI_AGAIN/ETIMEDOUT，附 hostname/port）
   * - Bun：连接失败抛 `Error("Unable to connect. Is the computer able to access the url?")`，
   *   `code: "ConnectionRefused"` 直接挂在错误对象自身，**无 cause**，也不附 hostname/port
   *
   * @returns 提取到的连接错误码与主机信息；无法识别（HTTP/超时/业务错误）返回 null
   */
  protected static extractFetchCause(error: unknown): {
    code: string;
    hostname: string;
    port: number;
  } | null {
    if (!error || typeof error !== 'object') return null;
    // undici 结构：code 在 error.cause 上；Bun 结构：code 直接挂在 error 上
    const cause = (error as { cause?: unknown }).cause;
    const src =
      cause && typeof cause === 'object' && 'code' in cause
        ? cause
        : (error as { code?: unknown });
    const code = (src as { code?: string }).code;
    if (typeof code !== 'string' || !code) return null;
    const c = src as { hostname?: string; port?: number };
    return { code, hostname: c.hostname ?? '', port: c.port ?? 0 };
  }

  /**
   * 判断是否为可重试的网络连接错误（仅瞬态连接故障）：
   * - undici/Node：`TypeError`
   * - Bun：`Error` 且 `code === 'ConnectionRefused'`（DNS 解析失败/连接被拒绝/TCP 重置统一归此类）
   * 不重试：HTTP 错误响应（正常返回）、超时（DOMException TimeoutError）、业务错误。
   */
  protected static isRetryableConnectError(error: unknown): boolean {
    if (error instanceof TypeError) return true;
    if (error instanceof Error && error.name === 'Error') {
      const code = (error as { code?: unknown }).code;
      return code === 'ConnectionRefused';
    }
    return false;
  }

  /**
   * 带连接重试的 fetch 包装（已注入系统 CA 证书 dispatcher）。
   *
   * 仅在网络连接阶段失败时重试（TypeError / Bun ConnectionRefused），
   * 不重试 HTTP 错误响应或超时。
   * 适用场景：Provider API 网关偶发断连、DNS 闪断、TCP 重置等瞬态网络故障。
   * 重试间隔采用线性退避（1s, 2s, 4s...）。
   *
   * @param url - 请求 URL
   * @param init - fetch Init 选项
   * @param maxRetries - 最大重试次数（默认 1，即最多请求 2 次）
   * @returns fetch Response
   */
  protected static async fetchWithConnectionRetry(
    url: string,
    init?: RequestInit,
    maxRetries: number = 1
  ): Promise<Response> {
    let lastError: Error | null = null;

    // 注入系统 CA 证书 dispatcher（解决 Windows SSL 证书验证问题）
    const caInit = BaseAIProvider.injectCADispatcher(init);

    // TTFB 耗时统计（2026-08-16）：请求发出到响应头返回（含连接重试）的耗时。
    // 所有 Provider 的 chat/chatStream 均经此入口，一处覆盖全量网络请求，
    // 排查 Provider 慢/断连时可直接看耗时与重试次数。
    const requestStart = Date.now();
    const urlSummary = BaseAIProvider.summarizeUrl(url);
    let attempts = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      attempts = attempt + 1;
      try {
        const response = await fetch(url, caInit);
        logger.info('provider 请求完成（TTFB）', {
          url: urlSummary,
          elapsedMs: Date.now() - requestStart,
          attempts,
          status: response.status,
          ok: response.ok,
        });
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 仅重试网络连接错误（TypeError / Bun ConnectionRefused），不重试：
        // - HTTP 错误响应（response.ok === false 不会 throw，正常返回）
        // - AbortError（DOMException，用户主动取消或超时）
        if (
          BaseAIProvider.isRetryableConnectError(error) &&
          attempt < maxRetries
        ) {
          const delay = 1000 * Math.pow(2, attempt);

          // 详细重试日志：记录本次失败原因、重试间隔与底层 cause，
          // 便于排查 Provider 网络抖动/断连是否频繁及退避节奏（2026-08-17）
          const cause = BaseAIProvider.extractFetchCause(error);
          logger.warn('provider 请求连接失败，将按退避重试', {
            url: urlSummary,
            elapsedMs: Date.now() - requestStart,
            retryIndex: attempt + 1, // 第几次重试（1-based）
            maxAttempts: maxRetries + 1, // 总尝试次数
            delayMs: delay, // 本次重试前等待间隔（线性退避 1s,2s,4s...）
            nextAttemptMs: Date.now() + delay,
            error: lastError.message,
            causeCode: cause?.code,
            causeHost: cause?.hostname,
            causePort: cause?.port,
          });

          void handleError(error, {
            module: 'ai:baseProvider',
            action: 'fetchRetry',
            context: { url, attempt: attempt + 1, delayMs: delay },
          });

          await new Promise<void>((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // 非 TypeError 错误直接抛出（超时、取消等），记录失败耗时便于排查
        logger.warn('provider 请求失败', {
          url: urlSummary,
          elapsedMs: Date.now() - requestStart,
          attempts,
          errorType: lastError.constructor.name,
          error: lastError.message,
          // fetch 底层连接错误原因（ENOTFOUND/ECONNREFUSED/EAI_AGAIN/ConnectionRefused 等）
          causeCode: BaseAIProvider.extractFetchCause(error)?.code,
        });
        throw error;
      }
    }

    // 网络连接错误重试耗尽
    logger.warn('provider 请求失败（连接重试耗尽）', {
      url: urlSummary,
      elapsedMs: Date.now() - requestStart,
      attempts,
      error: lastError?.message ?? String(lastError),
      causeCode: lastError
        ? BaseAIProvider.extractFetchCause(lastError)?.code
        : undefined,
    });
    throw lastError;
  }

  /**
   * URL 日志摘要：仅保留 host + pathname（剥离 query/敏感参数并防超长），
   * 供耗时统计日志使用，避免把完整 URL（可能含 token/密钥）写进日志。
   */
  private static summarizeUrl(url: string): string {
    try {
      const u = new URL(url);
      return `${u.host}${u.pathname}`;
    } catch {
      return url.length > 100 ? `${url.slice(0, 100)}…` : url;
    }
  }

  // ============================================================
  // 流式耗时统计
  // ============================================================

  /**
   * 流式请求耗时统计包装器（2026-08-16）：包装 Provider 的 chatStream 生成器，
   * 统一统计流式总耗时与 chunk 数。正常完成打 info，异常/中断打 warn。
   * 各 Provider 的 chatStream 入口用 `yield*` 委托本包装器即可接入，
   * return 值（如 usage）通过 yield* 透传，行为不变。
   */
  protected static async *wrapChatStreamMeasure<T, TReturn = void>(
    label: string,
    stream: AsyncGenerator<T, TReturn>
  ): AsyncGenerator<T, TReturn> {
    const start = Date.now();
    let chunkCount = 0;
    try {
      // 必须手动 next() 迭代：for await 会丢弃内部生成器的 return 值，
      // 导致上游 result.value 变 undefined（finalResponse.tool_calls 丢失 → 工具调用不执行）。
      let result = await stream.next();
      while (!result.done) {
        chunkCount++;
        yield result.value as T;
        result = await stream.next();
      }
      logger.info('provider 流式完成', {
        provider: label,
        elapsedMs: Date.now() - start,
        chunkCount,
      });
      return result.value;
    } catch (error) {
      logger.warn('provider 流式失败', {
        provider: label,
        elapsedMs: Date.now() - start,
        chunkCount,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 非流式聊天请求耗时统计（2026-08-16）：包装 Provider 的 chat 方法，
   * 统计从入口到响应完成的耗时。正常完成打 info，失败打 warn。
   * 各 Provider 的 chat 入口用 `measureChat(label, () => this.xxx(...))`
   * 接入即可，返回值透传，行为不变。
   */
  protected static async measureChat<T>(
    label: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      logger.info('provider 聊天完成', {
        provider: label,
        elapsedMs: Date.now() - start,
      });
      return result;
    } catch (error) {
      logger.warn('provider 聊天失败', {
        provider: label,
        elapsedMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================
  // 预连接
  // ============================================================

  /**
   * 预连接到 Provider 端点（发送 HEAD 请求预热连接池）。
   * 失败不抛出，仅静默忽略。
   */
  async preconnect(): Promise<void> {
    const baseUrl = this.resolveBaseUrl();
    if (!baseUrl) return;

    try {
      await fetch(baseUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      // 预连接失败不抛出
    }
  }

  // ============================================================
  // 思考模式 / 结构化输出 / 压缩通知
  // ============================================================

  /**
   * 当前模型是否支持思考模式（子类按需覆盖）。
   *
   * @param _model - 模型名
   * @returns 默认 false
   */
  supportsThinking(_model: string): boolean {
    return false;
  }

  /**
   * 当前模型是否支持结构化输出（子类按需覆盖）。
   *
   * @param _model - 模型名
   * @returns 默认 false
   */
  supportsStructuredOutputs(_model: string): boolean {
    return false;
  }

  /**
   * 通知压缩事件（重置 529 错误计数）。
   * 当外部触发上下文压缩时，重置退避状态以避免过激退避。
   */
  notifyCompaction(): void {
    this.consecutive529Errors = 0;
  }

  // ============================================================
  // HTTP 错误处理
  // ============================================================

  /**
   * HTTP 响应错误统一处理。
   * 将 HTTP 状态码和状态文本包装为 AppError 抛出。
   *
   * @param response - HTTP Response 对象
   * @param context - 错误上下文描述（可选）
   */
  protected handleHttpError(response: Response, context?: string): never {
    const status = response.status;
    const statusText = response.statusText;
    const message = `${this.id} API error: ${status} - ${statusText}${
      context ? ` (${context})` : ''
    }`;

    throw new AppError(
      message,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      String(status)
    );
  }

  // ============================================================
  // SSE 流式读取（三种格式分发）
  // ============================================================

  /**
   * P2-13/T-1 统一修复：带无数据超时的 reader.read()。
   * Provider 返回 200 后 SSE body 流中断时，原生 reader.read() 会永久挂起，
   * 导致 streamMessage 卡在 await gen.next()、会话互斥锁（SimpleMutex）永久不释放。
   * 各 Provider 的流式读取统一调用此方法。
   *
   * 超时策略（2026-08-18 优化）：
   * - 首 chunk（TTFB）：默认 120s，覆盖推理模型（GLM-Z1/DeepSeek-R1）长时间思考
   * - 后续 chunk：默认 90s，覆盖网络抖动/服务端短暂停滞
   * - 重试次数：2 次（总等待上限 120s + 90s + 90s = 300s，与 L1 请求总超时对齐）
   *
   * 诊断日志（module: ai:baseProvider，排查超时用）：
   * - debug：每块读取（序号/字节数）、流正常结束
   * - warn：超时（idle 时长/已读块数/总耗时/场景分类）、读取异常、cancel 失败
   *
   * @param reader - response.body.getReader() 返回的 reader
   * @param timeoutMs - 无数据超时（默认 90s，首 chunk 自动用 120s）
   * @param timeoutRetries - 超时重试次数（默认 2 次）
   */
  protected async readStreamChunkWithTimeout(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    timeoutMs: number = 90_000,
    timeoutRetries: number = 2
  ): Promise<{ done: boolean; value: Uint8Array | undefined }> {
    // 每次流式调用共享的读取诊断状态（按 reader 隔离）
    let state = streamReadState.get(reader);
    if (!state) {
      state = {
        chunkCount: 0,
        lastChunkAt: Date.now(),
        startedAt: Date.now(),
        lastIntervalMs: 0,
        strikes: 0,
      };
      streamReadState.set(reader, state);
    }
    state.chunkCount++;

    // 首 chunk 特殊处理：推理模型（GLM-Z1/DeepSeek-R1）首 token 可能 60-90s
    // chunkCount === 1 表示首次 read()（等待响应头/首 chunk），用更长超时
    const isFirstChunk = state.chunkCount === 1;
    const effectiveTimeoutMs = isFirstChunk
      ? Math.max(timeoutMs, 120_000) // 首 chunk 至少 120s
      : timeoutMs;

    try {
      // 每次读取前的"等待"标记：排查挂起时可确认最后一次 read() 已发出但未返回
      logger.debug(`[${this.id}] 流式读取等待第 ${state.chunkCount} 块`, {
        chunkIndex: state.chunkCount,
        elapsedMs: Date.now() - state.startedAt,
        lastChunkAt: new Date(state.lastChunkAt).toISOString(),
        isFirstChunk,
        effectiveTimeoutMs,
      });

      // 每轮新建无数据超时计时器。关键：reader.read() 先返回（流活跃）时
      // 必须 clearTimeout —— 否则 timer 在到期后执行 reject，对已 settle 的 race
      // 里的 promise 执行 reject，无人消费 → unhandledRejection。
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        const failAfterExhausted = () => {
          state.strikes++;
          if (state.strikes > timeoutRetries) {
            // 连续超时达到阈值：取消流并报错（真挂起）
            const idleMs = Date.now() - state.lastChunkAt;
            // 场景分类：便于日志快速定位超时原因
            // - TTFB_TIMEOUT: 首 token 超时（推理模型思考长 / 服务端排队）
            // - INTER_CHUNK_TIMEOUT: chunk 间隔超时（网络抖动 / 服务端短暂停滞）
            // - STREAM_STALLED: 流停滞（可能服务端挂起 / 连接半关闭）
            const scenario = isFirstChunk
              ? 'TTFB_TIMEOUT'
              : state.lastIntervalMs > effectiveTimeoutMs
                ? 'INTER_CHUNK_TIMEOUT'
                : 'STREAM_STALLED';
            logger.warn(
              `[${this.id}] 流式读取超时（${effectiveTimeoutMs / 1000}s 无数据，已重试 ${timeoutRetries} 次）`,
              {
                timeoutMs: effectiveTimeoutMs,
                baseTimeoutMs: timeoutMs,
                isFirstChunk,
                idleMs,
                chunkCount: state.chunkCount,
                totalMs: Date.now() - state.startedAt,
                lastIntervalMs: state.lastIntervalMs,
                lastChunkAt: new Date(state.lastChunkAt).toISOString(),
                awaitingFirstChunk: isFirstChunk,
                scenario,
                strikes: state.strikes,
              }
            );
            reject(
              new Error(
                `${this.id} stream: ${effectiveTimeoutMs / 1000}s 无数据（重试 ${timeoutRetries} 次后仍无数据），连接可能挂起`
              )
            );
            return;
          }
          // 首次超时：仅告警并继续等待（网络抖动/慢响应可恢复），即自动重试
          logger.warn(
            `[${this.id}] 流式读取超时（第 ${state.strikes}/${timeoutRetries + 1} 次，继续等待 ${effectiveTimeoutMs / 1000}s）`,
            {
              timeoutMs: effectiveTimeoutMs,
              baseTimeoutMs: timeoutMs,
              isFirstChunk,
              strikes: state.strikes,
              timeoutRetries,
              chunkCount: state.chunkCount,
              totalMs: Date.now() - state.startedAt,
              lastIntervalMs: state.lastIntervalMs,
              lastChunkAt: new Date(state.lastChunkAt).toISOString(),
              scenario: isFirstChunk ? 'TTFB_TIMEOUT_RETRY' : 'INTER_CHUNK_TIMEOUT_RETRY',
            }
          );
          timer = setTimeout(failAfterExhausted, effectiveTimeoutMs);
        };
        timer = setTimeout(failAfterExhausted, effectiveTimeoutMs);
      });
      // 双保险：极端时序下（clearTimeout 未生效）该 promise 的孤儿 rejection
      // 不应触发全局 unhandledRejection；实际错误仍由 race 正常传递
      timeoutPromise.catch(() => {});

      const result = (await Promise.race([
        reader.read(),
        timeoutPromise,
      ])) as ReadableStreamReadResult<Uint8Array>;
      clearTimeout(timer);

      if (result.done) {
        logger.debug(`[${this.id}] 流式读取结束`, {
          chunkCount: state.chunkCount,
          totalMs: Date.now() - state.startedAt,
          lastIntervalMs: state.lastIntervalMs,
        });
        streamReadState.delete(reader);
      } else {
        const now = Date.now();
        state.lastIntervalMs = now - state.lastChunkAt;
        state.lastChunkAt = now;
        state.strikes = 0; // 读到数据即重置超时重试计数
        logger.debug(`[${this.id}] 流式读取到块`, {
          chunkIndex: state.chunkCount,
          bytes: result.value?.length ?? 0,
          intervalMs: state.lastIntervalMs,
        });
      }
      return { done: result.done, value: result.value };
    } catch (err) {
      // 挂起超时或读取异常：取消底层流后透出错误，交由上层 finally 释放会话锁
      try {
        reader.cancel();
      } catch (cancelErr) {
        logger.warn(`[${this.id}] 流式读取取消失败`, {
          error:
            cancelErr instanceof Error ? cancelErr.message : String(cancelErr),
        });
      }
      logger.warn(`[${this.id}] 流式读取异常`, {
        error: err instanceof Error ? err.message : String(err),
        chunkCount: state.chunkCount,
        totalMs: Date.now() - state.startedAt,
        lastIntervalMs: state.lastIntervalMs,
        lastChunkAt: new Date(state.lastChunkAt).toISOString(),
        isFirstChunk,
        scenario: isFirstChunk ? 'TTFB_FAILURE' : 'STREAM_FAILURE',
      });
      streamReadState.delete(reader);
      throw err;
    }
  }

  /**
   * 读取 SSE 流，按格式分发到具体解析器。
   *
   * @param response - fetch Response 对象（需 response.body 可读）
   * @param format - SSE 格式枚举
   * @param onEvent - 事件回调（text / tool_call / thinking / usage / done / error）
   * @param pendingToolCalls - 可选的 tool_calls 累积容器（由调用方创建，流结束后读取）
   */
  protected async readSSEStream(
    response: Response,
    format: SSEFormat,
    onEvent: (event: TransportStreamEvent) => void,
    pendingToolCalls?: Map<number, PendingToolCall>
  ): Promise<void> {
    if (!response.body) {
      const headerObj: Record<string, string> = {};
      response.headers.forEach((v, k) => { headerObj[k] = v; });
      logger.warn(`[${this.id}] 流式响应体为空`, {
        status: response.status,
        statusText: response.statusText,
        headers: headerObj,
      });
      throw new AppError(
        `${this.id}: 响应体为空`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1002'
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const streamStartedAt = Date.now();
    let firstChunkAt: number | null = null;
    let chunkCount = 0;
    let totalBytes = 0;
    let textEventCount = 0;
    let toolCallEventCount = 0;
    let thinkingEventCount = 0;
    let usageEventCount = 0;
    let doneEventCount = 0;

    // 包装 onEvent：统计事件类型，便于排查"流式结束但未收到 done"等异常
    const wrappedOnEvent: typeof onEvent = (event) => {
      switch (event.type) {
        case 'text': textEventCount++; break;
        case 'tool_call': toolCallEventCount++; break;
        case 'thinking': thinkingEventCount++; break;
        case 'usage': usageEventCount++; break;
        case 'done':
          doneEventCount++;
          logger.info(`[${this.id}] 收到 done 事件`, {
            finishReason: event.response?.finishReason ?? null,
            model: event.response?.model ?? null,
            elapsedMs: Date.now() - streamStartedAt,
            chunkCount,
            textEventCount,
            toolCallEventCount,
            thinkingEventCount,
          });
          break;
        case 'error':
          logger.warn(`[${this.id}] 收到 error 事件`, {
            error: (event as { error?: string }).error ?? null,
            elapsedMs: Date.now() - streamStartedAt,
            chunkCount,
          });
          break;
      }
      onEvent(event);
    };

    // 排查流式挂起：记录流开始（id/format/无数据超时配置）
    logger.info(`[${this.id}] 流式读取开始`, {
      format,
      timeoutMs: 90_000, // readStreamChunkWithTimeout 默认无数据超时（首 chunk 自动 120s）
      firstChunkTimeoutMs: 120_000, // 首 chunk 超时（覆盖推理模型 TTFB）
      timeoutRetries: 2, // 重试次数（总等待上限 120+90+90=300s）
      responseStatus: response.status,
      contentLength: response.headers.get('content-length'),
    });

    try {
      while (true) {
        const { done, value } = await this.readStreamChunkWithTimeout(reader);
        if (done) break;

        // 首 chunk 到达：记录 TTFB（Time To First Byte）
        if (firstChunkAt === null) {
          firstChunkAt = Date.now();
          logger.info(`[${this.id}] 首 chunk 到达`, {
            ttfbMs: firstChunkAt - streamStartedAt,
            firstChunkBytes: value?.length ?? 0,
          });
        }
        chunkCount++;
        totalBytes += value?.length ?? 0;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              logger.info(`[${this.id}] 收到 [DONE] 标记，流式结束`, {
                chunkCount,
                totalBytes,
                elapsedMs: Date.now() - streamStartedAt,
                doneEventCount,
                textEventCount,
                toolCallEventCount,
                thinkingEventCount,
              });
              return;
            }

            try {
              const json = JSON.parse(data);

              switch (format) {
                case SSEFormat.OPENAI:
                  this.parseOpenaiSSELine(json, wrappedOnEvent, pendingToolCalls);
                  break;
                case SSEFormat.ANTHROPIC:
                  this.parseAnthropicSSELine(json, wrappedOnEvent, pendingToolCalls);
                  break;
                case SSEFormat.GOOGLE:
                  this.parseGoogleSSELine(json, wrappedOnEvent);
                  break;
              }
            } catch (err) {
              // JSON 解析失败：记录 warn 便于排查损坏的 SSE 数据
              logger.warn(`[${this.id}] SSE JSON 解析失败，跳过该行`, {
                linePreview: trimmed.substring(0, 200),
                lineLength: trimmed.length,
                error: err instanceof Error ? err.message : String(err),
                chunkIndex: chunkCount,
              });
            }
          }
        }
      }
      // reader.read() 返回 done=true（流自然结束）但未收到 [DONE] 标记或 done 事件
      // 这是异常情况：可能是流被服务端中途关闭
      logger.info(`[${this.id}] 流式读取完成`, {
        totalMs: Date.now() - streamStartedAt,
        ttfbMs: firstChunkAt ? firstChunkAt - streamStartedAt : null,
        chunkCount,
        totalBytes,
        textEventCount,
        toolCallEventCount,
        thinkingEventCount,
        usageEventCount,
        doneEventCount,
        avgChunkBytes: chunkCount > 0 ? Math.round(totalBytes / chunkCount) : 0,
        endedByDoneMarker: doneEventCount > 0,
        // 若 doneEventCount=0 且 chunkCount>0，说明流结束但未收到 done 事件
        // 可能是服务端异常关闭或 SSE 格式不符合预期
        abnormalEnd: doneEventCount === 0 && chunkCount > 0,
      });
    } finally {
      logger.debug(`[${this.id}] 释放 reader 锁`, {
        chunkCount,
        totalMs: Date.now() - streamStartedAt,
      });
      reader.releaseLock();
    }
  }

  // ============================================================
  // OpenAI 格式 SSE 解析（含流式 tool_calls 累积）
  // ============================================================

  /**
   * 解析 OpenAI 格式的 SSE 数据行。
   *
   * 处理特性：
   * - delta.content → text 事件
   * - delta.reasoning_content → thinking 事件
   * - delta.tool_calls → 按 index 合并分片 + arguments 字符串拼接
   * - usage → usage 事件
   * - finish_reason === 'tool_calls' → tool_call 事件 + done 事件
   * - 其他 finish_reason → done 事件
   *
   * @param json - 解析后的 SSE JSON 对象
   * @param onEvent - 事件回调
   * @param pendingToolCalls - tool_calls 累积容器（来自 DeepSeek 的流式 tool_calls 方案）
   */
  protected parseOpenaiSSELine(
    json: Record<string, unknown>,
    onEvent: (event: TransportStreamEvent) => void,
    pendingToolCalls?: Map<number, PendingToolCall>
  ): void {
    const choices = json.choices as Array<Record<string, unknown>> | undefined;
    if (!choices || !choices[0]) return;

    const delta = (choices[0].delta || {}) as Record<string, unknown>;
    const finishReason = choices[0].finish_reason as string | undefined;

    // 1. 文本内容
    if (delta.content) {
      onEvent({ type: 'text', content: delta.content as string });
    }

    // 2. 思考过程
    if (delta.reasoning_content) {
      onEvent({
        type: 'thinking',
        content: delta.reasoning_content as string,
      });
    }

    // 3. 工具调用分片累积（按 index 合并）
    const streamToolCalls = delta.tool_calls as
      | Array<Record<string, unknown>>
      | undefined;
    if (streamToolCalls && pendingToolCalls) {
      for (const tc of streamToolCalls) {
        const idx = tc.index as number;
        const func = tc.function as Record<string, unknown> | undefined;

        let pending = pendingToolCalls.get(idx);
        if (!pending) {
          pending = { id: '', name: '', arguments: '' };
          pendingToolCalls.set(idx, pending);
        }
        if (tc.id) pending.id = tc.id as string;
        if (func) {
          if (func.name) pending.name = func.name as string;
          if (func.arguments) pending.arguments += func.arguments as string;
        }
      }
    }

    // 4. 用量
    const usage = json.usage as Record<string, number> | undefined;
    if (usage) {
      const inputTokens = usage.prompt_tokens || 0;
      const outputTokens = usage.completion_tokens || 0;
      // [v1.2] 三级回退 cache 提取（OpenAI → Anthropic → DeepSeek）
      const cacheRead =
        (
          (json.usage as Record<string, unknown>)?.prompt_tokens_details as
            | Record<string, number>
            | undefined
        )?.cached_tokens ??
        usage.cache_read_input_tokens ??
        usage.prompt_cache_hit_tokens ??
        0;
      const cacheCreation =
        usage.cache_creation_input_tokens ??
        usage.prompt_cache_miss_tokens ??
        0;
      onEvent({
        type: 'usage',
        usage: {
          inputTokens,
          outputTokens,
          cacheReadTokens: cacheRead,
          cacheCreationTokens: cacheCreation,
          totalTokens: inputTokens + outputTokens,
        },
      });
    }

    // 5. 完成：tool_calls 触发 tool_call 事件
    if (
      finishReason === 'tool_calls' &&
      pendingToolCalls &&
      pendingToolCalls.size > 0
    ) {
      const sortedCalls = Array.from(pendingToolCalls.entries())
        .sort(([a], [b]) => a - b)
        .map(([_, tc]) => {
          try {
            // 修复可能的 Windows 路径反斜杠问题后解析
            const repaired = repairModelJson(tc.arguments);
            return {
              id: tc.id,
              name: tc.name,
              arguments: JSON.parse(repaired) as Record<string, unknown>,
            };
          } catch (err) {
            return {
              id: tc.id,
              name: tc.name,
              arguments: { _raw: tc.arguments },
            };
          }
        });

      onEvent({
        type: 'tool_call',
        call: {
          id: sortedCalls[0]?.id || '',
          name: sortedCalls[0]?.name || '',
          arguments: JSON.stringify(sortedCalls[0]?.arguments || {}),
        },
      });

      pendingToolCalls.clear();
    }

    // 6. 最终完成
    if (finishReason && finishReason !== 'tool_calls') {
      const responseModel = json.model as string | undefined;
      const responseId = json.id as string | undefined;
      onEvent({
        type: 'done',
        response: {
          content: null,
          toolCalls: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            totalTokens: 0,
          },
          reasoning: null,
          finishReason,
          model: responseModel || '',
          id: responseId || '',
        },
      });
    }
  }

  // ============================================================
  // Anthropic 格式 SSE 解析
  // ============================================================

  /**
   * 解析 Anthropic Messages API 格式的 SSE 数据行。
   *
   * 处理事件类型：
   * - content_block_delta（text_delta / thinking_delta）
   * - content_block_start（tool_use）
   * - content_block_delta.tool_use（partial_json 累积）
   * - message_delta（stop_reason + usage）
   * - message_stop（done 事件）
   *
   * @param json - 解析后的 SSE JSON 对象
   * @param onEvent - 事件回调
   * @param pendingToolCalls - tool_calls 累积容器
   */
  protected parseAnthropicSSELine(
    json: Record<string, unknown>,
    onEvent: (event: TransportStreamEvent) => void,
    pendingToolCalls?: Map<number, PendingToolCall>
  ): void {
    const type = json.type as string | undefined;

    switch (type) {
      case 'content_block_delta': {
        const delta = (json.delta || {}) as Record<string, unknown>;
        const deltaType = delta.type as string | undefined;

        if (deltaType === 'text_delta' && delta.text) {
          onEvent({ type: 'text', content: delta.text as string });
        }
        if (deltaType === 'thinking_delta' && delta.thinking) {
          onEvent({
            type: 'thinking',
            content: delta.thinking as string,
          });
        }
        break;
      }

      case 'content_block_start': {
        const contentBlock = (json.content_block || {}) as Record<
          string,
          unknown
        >;
        if (contentBlock.type === 'tool_use' && pendingToolCalls) {
          const idx = (json.index as number) || 0;
          pendingToolCalls.set(idx, {
            id: (contentBlock.id as string) || '',
            name: (contentBlock.name as string) || '',
            arguments: '',
          });
        }
        break;
      }

      case 'content_block_delta': {
        // Anthropic 的 tool_use delta 子类型
        const delta = (json.delta || {}) as Record<string, unknown>;
        if (
          (delta.type as string) === 'input_json_delta' &&
          delta.partial_json &&
          pendingToolCalls
        ) {
          const idx = (json.index as number) || 0;
          const pending = pendingToolCalls.get(idx);
          if (pending) {
            pending.arguments += delta.partial_json as string;
          }
        }
        break;
      }

      case 'message_delta': {
        const delta = (json.delta || {}) as Record<string, unknown>;
        const stopReason = delta.stop_reason as string | undefined;

        // tool_use 停止 → 组装 tool_calls
        if (
          stopReason === 'tool_use' &&
          pendingToolCalls &&
          pendingToolCalls.size > 0
        ) {
          const sortedCalls = Array.from(pendingToolCalls.entries())
            .sort(([a], [b]) => a - b)
            .map(([_, tc]) => {
              try {
                return {
                  id: tc.id,
                  name: tc.name,
                  arguments: JSON.parse(tc.arguments) as Record<
                    string,
                    unknown
                  >,
                };
              } catch (err) {
                return {
                  id: tc.id,
                  name: tc.name,
                  arguments: { _raw: tc.arguments },
                };
              }
            });

          onEvent({
            type: 'tool_call',
            call: {
              id: sortedCalls[0]?.id || '',
              name: sortedCalls[0]?.name || '',
              arguments: JSON.stringify(sortedCalls[0]?.arguments || {}),
            },
          });

          pendingToolCalls.clear();
        }

        // 用量
        const usage = json.usage as Record<string, number> | undefined;
        if (usage) {
          onEvent({
            type: 'usage',
            usage: {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              cacheReadTokens: usage.cache_read_input_tokens || 0,
              cacheCreationTokens: usage.cache_creation_input_tokens || 0,
              totalTokens:
                (usage.input_tokens || 0) + (usage.output_tokens || 0),
            },
          });
        }
        break;
      }

      case 'message_stop': {
        onEvent({
          type: 'done',
          response: {
            content: null,
            toolCalls: [],
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              totalTokens: 0,
            },
            reasoning: null,
            finishReason: 'end_turn',
            model: (json.model as string) || '',
            id: (json.id as string) || '',
          },
        });
        break;
      }
    }
  }

  // ============================================================
  // Google 格式 SSE 解析
  // ============================================================

  /**
   * 解析 Google Gemini 格式的 SSE 数据行。
   *
   * 格式：data: {"candidates": [...], "usageMetadata": {...}}
   *
   * @param json - 解析后的 SSE JSON 对象
   * @param onEvent - 事件回调
   */
  protected parseGoogleSSELine(
    json: Record<string, unknown>,
    onEvent: (event: TransportStreamEvent) => void
  ): void {
    const candidates = json.candidates as
      | Array<Record<string, unknown>>
      | undefined;
    if (!candidates || !candidates[0]) return;

    const content = candidates[0].content as
      | Record<string, unknown>
      | undefined;
    if (!content) return;

    const parts = (content.parts || []) as Array<Record<string, unknown>>;
    for (const part of parts) {
      if (part.text) {
        onEvent({ type: 'text', content: part.text as string });
      }
    }

    // finishReason
    const finishReason = candidates[0].finishReason as string | undefined;
    if (finishReason) {
      onEvent({
        type: 'done',
        response: {
          content: null,
          toolCalls: [],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            totalTokens: 0,
          },
          reasoning: null,
          finishReason: finishReason.toLowerCase(),
          model: (json.modelVersion as string) || '',
          id: '',
        },
      });
    }

    // usageMetadata
    const usage = json.usageMetadata as Record<string, number> | undefined;
    if (usage) {
      onEvent({
        type: 'usage',
        usage: {
          inputTokens: usage.promptTokenCount || 0,
          outputTokens: usage.candidatesTokenCount || 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          totalTokens:
            (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0),
        },
      });
    }
  }

  // ============================================================
  // 工具注册 & 执行器
  // ============================================================

  /**
   * 设置工具注册表。
   *
   * @param registry - 工具注册表实例或 null
   */
  setToolRegistry(registry: ToolRegistry | null): void {
    this.toolRegistry = registry;
  }

  /**
   * 设置工具执行器。
   *
   * @param executor - 工具执行器实例或 null
   */
  setToolExecutor(executor: IToolExecutor | null): void {
    this.toolExecutor = executor;
  }

  // ============================================================
  // API Key 运行时设置
  // ============================================================

  /**
   * 运行时设置 API Key（子类可覆盖做额外处理）。
   *
   * @param _key - API Key
   */
  setApiKey(_key: string): void {
    // 子类按需覆盖
  }

  // ============================================================
  // 配置验证
  // ============================================================

  /**
   * 验证配置是否合法。
   *
   * @param config - Provider 配置
   * @returns 验证结果（包含错误 / 警告列表）
   */
  validateConfig(config: ProviderConfig): ProviderValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.apiKey && !this.resolveApiKey()) {
      warnings.push(`未配置 API Key（Provider: ${this.id}）`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ============================================================
  // 抽象方法（子类必须实现）
  // ============================================================

  /**
   * 非流式聊天。
   *
   * @param messages - 消息列表
   * @param options - 选项（工具定义、模型选择等）
   * @returns 完整 ChatResponse
   */
  abstract chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse>;

  /**
   * 流式聊天。
   *
   * @param messages - 消息列表
   * @param options - 选项
   * @returns AsyncGenerator，产出文本/思考分块，最终返回 ChatResponse
   */
  abstract chatStream(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown>;

  /**
   * 获取支持的模型列表。
   *
   * @returns 模型名数组
   */
  abstract listModels(): Promise<string[]>;
}
