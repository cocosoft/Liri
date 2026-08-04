// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software and to permit persons to whom the Software is
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
 * SmartRouter — 智能路由主决策管线
 *
 * 职责：运行时智能决策管线，通过 LLM Judge 动态判断请求复杂度，
 *       分配不同 tier 的模型处理。持有 ModelRouter 实例作为无配置时的兜底。
 *
 * 五层决策：
 * 1. 开关检测：用户关闭 → 直通 ModelRouter（fallbackToModelRouter）
 * 2. 快速通道：SimpleQA / 规则引擎命中 → 直接返回（零 token 消耗）
 * 3. 会话黏性：同 session 已有决策 → 复用上次 tier
 * 4. LLM Judge：JudgeService 分级
 * 5. TierResolver：tier → model/provider
 * 6. SessionRouterStore：持久化本次决策
 *
 * Phase 2 扩展：
 * - execute()：带 FallbackChain + RetryPolicy 的执行
 *
 * 与 ModelRouter 的关系：
 *   本类持有 ModelRouter 作为兜底路由，当开关关闭或无智能决策时回退。
 *   两者是分层嵌套关系，不是并列竞争。
 *
 * 与 AppModelConfigService 的关系：
 *   AppModelConfigService 走管理 API 通道，与 SmartRouter 无直接交互。
 */

import type { AIProvider } from '../providers/AIProvider.js';
import { ProviderRegistry } from '@modules/ai';
import { ModelRouter, type PhaseContext } from '@modules/ai';
import { JudgeService } from './JudgeService.js';
import { TierResolver } from './TierResolver.js';
import { SessionRouterStore } from './SessionRouterStore.js';
import { executeFallbackChain } from './FallbackChain.js';
import type { FallbackChainOptions } from './FallbackChain.js';
import { executeWithRetry } from './RetryPolicy.js';
import type { RetryableResponse } from './RetryPolicy.js';
import { TaskDecomposer } from './TaskDecomposer.js';
import { OrchEngine } from './OrchEngine.js';
import type { OrchResult } from './OrchEngine.js';
import { AdaptiveRouter } from './AdaptiveRouter.js';
import type { RouterConfig, RouterTier, RouteDecision } from './types.js';
import {
  RouteKey,
  ROUTE_TO_TASK,
  JUDGE_ROUTES,
  CAPABILITY_ROUTES,
} from './routes.js';
import type { RouteKey as RouteKeyType } from './routes.js';
import { Logger, LogLevel } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';

const logger = new Logger({ level: LogLevel.INFO, module: 'ai:smart-router' });

/**
 * 全局活跃路由层级（用于前端状态栏展示）
 */
let lastActiveTier: RouterTier = 'medium';

/**
 * 获取最后活跃的路由层级
 */
export function getLastActiveTier(): RouterTier {
  return lastActiveTier;
}

export interface SmartRouterOptions {
  /** 路由配置 */
  config: RouterConfig;
  /** Provider 注册表（用于 TierResolver） */
  providerRegistry: ProviderRegistry;
  /** 可选：LocalAgent 的 classifyForJudge 函数 */
  classifyLocal?: (message: string) => Promise<RouterTier>;
  /** 可选：云端 Judge 用的 Provider */
  cloudJudgeProvider?: AIProvider;
  /** 可选：SessionRouterStore 实例 */
  sessionStore?: SessionRouterStore;
  /** 可选：任务分解用的 LLM Provider（不指定则只做简单分解） */
  decomposerProvider?: AIProvider;
  /** 可选：编排结果合成用的 LLM Provider（不指定则简单拼接） */
  synthesizeProvider?: AIProvider;
}

export class SmartRouter {
  private config: RouterConfig;
  private judgeService: JudgeService;
  private tierResolver: TierResolver;
  private sessionStore: SessionRouterStore | null;
  private modelRouter: ModelRouter;
  private taskDecomposer: TaskDecomposer;
  private orchEngine: OrchEngine;
  private adaptiveRouter: AdaptiveRouter;

  constructor(options: SmartRouterOptions) {
    this.config = options.config;
    this.judgeService = new JudgeService(
      options.classifyLocal ?? null,
      options.config.judge,
      options.cloudJudgeProvider
    );
    this.tierResolver = new TierResolver(
      options.config,
      options.providerRegistry
    );
    this.sessionStore = options.sessionStore ?? null;
    this.modelRouter = ModelRouter.getInstance();
    this.adaptiveRouter = new AdaptiveRouter(options.config);

    // 初始化 TaskDecomposer
    const classifyFn = options.classifyLocal
      ? async (msg: string) => this.judgeService.classify(msg)
      : null;
    this.taskDecomposer = new TaskDecomposer(
      classifyFn,
      options.decomposerProvider
    );

    // 初始化 OrchEngine
    this.orchEngine = new OrchEngine(
      this.taskDecomposer,
      async (msg, opts) => {
        return this.decide(msg, opts?.sessionId, {
          skipJudge: opts?.skipJudge,
          tierHint: opts?.tierHint,
        });
      },
      async (decision, msg) => {
        // 由 execute() 使用的 executeFn 占位 — 外部应优先调用 orchestrate()
        return '';
      },
      options.synthesizeProvider
    );
  }

  /**
   * 智能路由主入口
   *
   * @param message - 用户消息
   * @param sessionId - 可选：会话 ID（用于黏性路由）
   * @param options - 可选：skipJudge 跳过 Judge，tierHint 强制指定 tier
   * @returns 路由决策
   */
  async decide(
    message: string,
    sessionId?: string,
    options?: { skipJudge?: boolean; tierHint?: RouterTier }
  ): Promise<RouteDecision> {
    const otel = getOTelTracing();
    const span = otel.startSpan('ai.smart-router.decide', {
      'message.length': message.length,
      'session.id': sessionId ?? '',
      skip_judge: options?.skipJudge ?? false,
    });

    // 层 1：开关检测
    if (!this.config.enabled) {
      otel.endSpan(span, SpanStatusCode.OK);
      return this.fallbackToModelRouter(message, '用户已关闭智能路由');
    }

    // 层 3：会话黏性（跳过分级+Judge）
    if (sessionId && this.config.sessionSticky !== false) {
      const sticky = await this.trySessionSticky(sessionId);
      if (sticky) {
        otel.endSpan(span, SpanStatusCode.OK);
        return sticky;
      }
    }

    // 层 4：LLM Judge 分级
    let tier: RouterTier;
    let reason: string;

    if (options?.tierHint) {
      // Phase 3: 子任务编排传入的 tier hint，直接使用
      tier = options.tierHint;
      reason = `编排 tier hint: ${tier}`;
    } else if (options?.skipJudge) {
      tier = this.config.defaultTier;
      reason = '跳过 Judge，使用默认 tier';
    } else {
      try {
        const judgeResult = await this.judgeService.classify(message);
        tier = judgeResult.tier;
        reason = judgeResult.reason;
      } catch (error) {
        await handleError(error, {
          module: 'ai:smartRouter',
          action: 'decide',
        });
        logger.warning('SmartRouter: Judge 异常，使用默认 tier', { error });
        tier = this.config.defaultTier;
        reason = 'Judge 异常，使用默认 tier';
      }
    }

    // 层 5：TierResolver 解析
    const decision = this.tierResolver.resolve(tier);
    decision.reason = `${reason} → ${decision.reason}`;

    // 记录全局活跃层级
    lastActiveTier = decision.tier;

    // 层 6：持久化会话黏性
    if (sessionId && this.sessionStore) {
      this.persistSession(sessionId, decision).catch(async (err) => {
        await handleError(err, {
          module: 'ai:smartRouter',
          action: 'persistSession',
        });
        logger.warning('SmartRouter: 会话持久化失败', { error: err });
      });
    }

    logger.debug('SmartRouter: 决策完成', {
      tier: decision.tier,
      model: decision.model,
      provider: decision.provider,
    });

    otel.endSpan(span, SpanStatusCode.OK);

    return decision;
  }

  /**
   * 统一路由入口：根据 RouteKey 解析模型决策
   *
   * 替代各处散落的 modelRouter.resolve(taskType)，成为全系统唯一路由入口。
   *
   * 路由逻辑：
   * - chat 类 route（chat/coding/translation/agent/scheduled）→ 走 decide() Judge 分级
   * - 能力 route（image/embedding/vision/video/tts/stt/reranking）→ 从 modelRouter 直接取
   * - 开关关闭时 → 全部回退 modelRouter
   *
   * @param route - 路由键
   * @param options - 可选：message（chat 类需要）、sessionId、providerId
   * @returns 路由决策
   */
  resolve(
    route: RouteKeyType,
    options?: {
      message?: string;
      sessionId?: string;
      providerId?: string;
      phaseContext?: PhaseContext;
    }
  ): Promise<RouteDecision> {
    // 开关关闭 → 全部回退 ModelRouter 静态路由
    if (!this.config.enabled) {
      const taskType = ROUTE_TO_TASK[route];
      const model = options?.phaseContext
        ? this.modelRouter.resolveWithPhase(taskType, options.phaseContext)
        : this.modelRouter.resolve(taskType);
      return Promise.resolve({
        provider: options?.providerId ?? '',
        model,
        tier: 'medium',
        reason: `SmartRouter 关闭 → ModelRouter.${taskType} → ${model}`,
        fastPath: true,
      });
    }

    // 能力路由：直接从 modelRouter 取（不需要 Judge 分级）
    if ((CAPABILITY_ROUTES as string[]).includes(route)) {
      const taskType = ROUTE_TO_TASK[route];
      const model = this.modelRouter.resolve(taskType);
      logger.debug(`SmartRouter: 能力路由 ${route} → ${model}`);
      return Promise.resolve({
        provider: options?.providerId ?? '',
        model,
        tier: 'medium',
        reason: `能力路由: ${route} → ${model}`,
        fastPath: true,
      });
    }

    // chat 类路由：走 decide() 进行 Judge 分级
    const message = options?.message ?? '';
    return this.decide(message, options?.sessionId);
  }

  /**
   * 查询当前路由是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * 获取当前路由配置
   */
  getConfig(): RouterConfig {
    return { ...this.config };
  }

  /**
   * 更新配置（运行时配置变化时调用）
   */
  updateConfig(config: RouterConfig): void {
    this.config = config;
    this.tierResolver.updateConfig(config);
    this.adaptiveRouter.updateConfig(config);
    // 重建 JudgeService 时需从旧实例提取 private 字段（classifyLocal、cloudProvider）
    const oldJudge = this.judgeService;
    type JudgeInternals = {
      classifyLocal: ((message: string) => Promise<RouterTier>) | null;
      cloudProvider: unknown;
    };
    const internals = oldJudge as unknown as JudgeInternals;
    this.judgeService = new JudgeService(
      internals.classifyLocal ?? null,
      config.judge,
      internals.cloudProvider as AIProvider | undefined
    );
  }

  /**
   * 执行路由决策（带 FallbackChain + RetryPolicy）
   *
   * 统一入口：通过 RouteKey 解析模型决策，再包裹 FallbackChain + RetryPolicy 执行。
   * 替代各处散落的"先 resolve 再手动执行"模式。
   *
   * 管线：resolve(route) → FallbackChain → RetryPolicy → executeFn
   *
   * @param route - 路由键（chat/image/embedding/...）
   * @param executeFn - 实际调用 provider 的函数，接收决策返回可重试响应
   * @param options - 可选：message（chat 类 Judge 需要）、sessionId
   * @returns 执行结果（含决策、响应、回退/重试信息）
   */
  async execute(
    route: RouteKeyType,
    executeFn: (decision: RouteDecision) => Promise<RetryableResponse>,
    options?: {
      message?: string;
      sessionId?: string;
    }
  ): Promise<{
    decision: RouteDecision;
    response: RetryableResponse;
    didFallback: boolean;
    retryCount: number;
  }> {
    // 1. 通过统一路由入口获取主决策
    const primaryDecision = await this.resolve(route, {
      message: options?.message,
      sessionId: options?.sessionId,
    });

    // 2. 如果启用了 fallback 链，构建回退执行
    if (
      this.config.fallback &&
      this.config.fallback.length > 0 &&
      !primaryDecision.fastPath
    ) {
      // 为回退链构造执行函数
      const executeForFallback: FallbackChainOptions['execute'] = async (
        ref,
        tier
      ) => {
        const fallbackDecision: RouteDecision = {
          provider: ref.provider,
          model: ref.model,
          tier,
          reason: `回退: ${ref.provider}/${ref.model}`,
        };
        return fallbackDecision;
      };

      try {
        const fallbackResult = await executeFallbackChain({
          fallbacks: this.config.fallback,
          tier: primaryDecision.tier,
          execute: executeForFallback,
          timeoutMs: 30000,
        });

        if (fallbackResult.didFallback) {
          logger.info('SmartRouter: 回退执行成功', {
            from: `${primaryDecision.provider}/${primaryDecision.model}`,
            to: `${fallbackResult.decision.provider}/${fallbackResult.decision.model}`,
          });
        }

        // 用回退后的决策执行
        const decision = fallbackResult.didFallback
          ? fallbackResult.decision
          : primaryDecision;

        // 3. 带重试策略执行
        const retryResult = await executeWithRetry(decision, {
          config: this.config,
          execute: executeFn,
        });

        return {
          decision,
          response: retryResult.response,
          didFallback: fallbackResult.didFallback,
          retryCount: retryResult.retryCount,
        };
      } catch (fallbackError) {
        // 回退链全部失败 → 用主决策 + 重试兜底
        await handleError(fallbackError, {
          module: 'ai:smartRouter',
          action: 'execute',
        });
        logger.warning('SmartRouter: 回退链全部失败，使用主决策重试', {
          error: (fallbackError as Error).message,
        });
      }
    }

    // 3. 无 fallback 或 fallback 失败：主决策 + 重试
    const retryResult = await executeWithRetry(primaryDecision, {
      config: this.config,
      execute: executeFn,
    });

    return {
      decision: primaryDecision,
      response: retryResult.response,
      didFallback: false,
      retryCount: retryResult.retryCount,
    };
  }

  /**
   * 编排复杂任务（Phase 3）
   * 当任务需要分解时自动分解并编排执行
   */
  async orchestrate(message: string): Promise<OrchResult> {
    return this.orchEngine.orchestrate(message);
  }

  /**
   * 获取自适应路由器（Phase 3）
   * 用于外部记录执行结果、查询推荐模型
   */
  getAdaptiveRouter(): AdaptiveRouter {
    return this.adaptiveRouter;
  }

  /**
   * 关闭时回退到 ModelRouter 静态路由
   */
  private fallbackToModelRouter(
    message: string,
    reason: string
  ): RouteDecision {
    const taskType = this.inferTaskType(message);
    const model = this.modelRouter.resolve(taskType);

    return {
      provider: '',
      model,
      tier: 'medium',
      reason: `${reason} → ModelRouter.${taskType} → ${model}`,
      fastPath: true,
    };
  }

  /**
   * 尝试从会话黏性获取上次决策
   */
  private async trySessionSticky(
    sessionId: string
  ): Promise<RouteDecision | null> {
    if (!this.sessionStore) return null;

    try {
      const record = await this.sessionStore.get(sessionId);
      if (record) {
        logger.debug('SmartRouter: 会话黏性命中', {
          sessionId,
          tier: record.tier,
        });
        return {
          provider: record.provider,
          model: record.model,
          tier: record.tier,
          reason: `会话黏性: ${record.tier}`,
        };
      }
    } catch (error) {
      await handleError(error, {
        module: 'ai:smartRouter',
        action: 'trySessionSticky',
      });
      logger.warning('SmartRouter: 会话黏性查询失败', { error });
    }

    return null;
  }

  /**
   * 持久化会话路由决策
   */
  private async persistSession(
    sessionId: string,
    decision: RouteDecision
  ): Promise<void> {
    try {
      await this.sessionStore!.set(
        sessionId,
        decision.tier,
        decision.provider,
        decision.model
      );
    } catch (error) {
      await handleError(error, {
        module: 'ai:smartRouter',
        action: 'persistSession',
      });
      logger.warning('SmartRouter: 会话持久化失败', { error });
    }
  }

  /**
   * 简单的消息 → 任务类型推断（用于 fallback 路径）
   */
  private inferTaskType(message: string): 'chat' | 'coding' | 'quick' {
    // 关键词启发式
    const lower = message.toLowerCase();

    if (
      /code|function|class|implement|refactor|debug|fix|error|bug|test/.test(
        lower
      )
    ) {
      return 'coding';
    }
    if (/hello|hi|你好|嗨|weather|time|date/.test(lower)) {
      return 'quick';
    }

    return 'chat';
  }
}
