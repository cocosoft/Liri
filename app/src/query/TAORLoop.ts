/**
 * TAORLoop — TAOR (Think-Act-Observe-Repeat) 循环编排器
 *
 * Phase 2 正式激活。整合 TokenBudget、StopHooks、LoopDetector、ErrorRecovery、
 * ContextTracker、Checkpoint、CircuitBreaker、RunLogger 等子模块。
 * ChatManager 和 PDCA 通过 TAORLoopDeps 依赖注入委托循环编排。
 *
 * 支持中断恢复（checkpoint/resume）机制。
 */

import { Logger } from '@modules/monitoring';
import { TokenBudgetManagerImpl, TokenBudgetStatus } from './TokenBudget.js';
import type {
  TokenBudgetConfig,
  TokenBudgetManager,
  TokenBudgetState,
} from './TokenBudget.js';
import { StopHookManager, DEFAULT_STOP_HOOK_PRIORITIES } from './StopHooks.js';
import type { StopHook, StopHookContext, StopHookReason } from './StopHooks.js';
import type { QueryEngine } from './QueryEngine.js';
import { ContextTracker } from './context/ContextTracker.js';
import type { CompressionRecord } from './context/ContextTracker.js';
import type {
  ContextEngineRegistry,
  CompressionFeature,
} from './context/ContextEngineRegistry.js';
import { TAORPhase } from './types.js';
import type { TAORCheckpoint, CheckpointStorage } from './types.js';
import { createLoopDetector } from './LoopDetector.js';
import type { LoopDetector } from './LoopDetector.js';
import { createErrorRecoveryManager } from './ErrorRecoveryManager.js';
import type { ErrorRecoveryManager } from './ErrorRecoveryManager.js';
import { createCircuitBreaker } from './CircuitBreaker.js';
import type { CircuitBreaker } from './CircuitBreaker.js';
import { createRunLogger } from './RunLogger.js';
import type { RunLogger } from './RunLogger.js';
import type { ChatMessage } from '../ai/models/types';

const logger = new Logger({ module: 'query:taorLoop' });

// ─── TAORLoop 依赖注入接口 ────────────────────────────
/**
 * TAORLoop 依赖注入接口（对标 cc_code QueryDeps）
 *
 * 由 ChatManager 和 PDCA 分别实现，通过 TAORLoop.run() 注入。
 * 品牌类型防止意外结构化类型匹配。
 */
declare const TAOR_LOOP_DEPS_BRAND: unique symbol;
export interface TAORLoopDeps {
  readonly [TAOR_LOOP_DEPS_BRAND]: typeof TAOR_LOOP_DEPS_BRAND;

  /** LLM 流式调用 */
  callModel: (
    messages: ChatMessage[],
    signal: AbortSignal
  ) => AsyncGenerator<{
    type: string;
    content?: string;
    toolCall?: unknown;
    [k: string]: unknown;
  }>;

  /** 工具批量执行 */
  executeTools: (
    toolCalls: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>,
    signal: AbortSignal
  ) => Promise<
    Array<{
      toolCallId?: string;
      toolName?: string;
      result?: unknown;
      error?: string;
    }>
  >;

  /** 消息持久化 */
  persistMessages: (messages: ChatMessage[]) => Promise<void>;

  /** 流式 chunk 透传 */
  onStreamChunk?: (chunk: unknown) => void;

  /** 是否需要继续（无 tool_use 时停止） */
  needsFollowUp?: (response: unknown) => boolean;

  /** 兜底路径：当 _runModern() 崩溃时，ChatManager 走旧循环 */
  fallbackToLegacy?: (
    error: Error,
    messages: ChatMessage[]
  ) => Promise<TAORLoopResult>;
}

// ─── 类型定义 ──────────────────────────────────────────

export interface TAORPhaseInfo {
  phase: TAORPhase;
  round: number;
  description?: string;
}

export interface TAORLoopConfig {
  maxTurns?: number;
  budgetConfig?: Partial<TokenBudgetConfig>;
  sessionId?: string;
  /** 是否启用检查点自动保存 */
  enableCheckpoint?: boolean;
  /** 检查点保存间隔（轮次） */
  checkpointInterval?: number;
  /** 检查点存储实现 */
  checkpointStorage?: CheckpointStorage;
  /** 上下文引擎注册中心（启用可插拔引擎选择与追踪） */
  contextEngineRegistry?: ContextEngineRegistry;
}

export interface TAORLoopResult {
  turnCount: number;
  totalTokens: number;
  durationMs: number;
  stopReason: StopHookReason;
  /** 是否从检查点恢复 */
  resumed?: boolean;
  /** 恢复时的检查点ID */
  checkpointId?: string;
}

export interface TAORPhaseCallback {
  onPhase?: (info: TAORPhaseInfo) => void;
  onError?: (error: Error, phase: TAORPhase, round: number) => void;
  onBudgetWarning?: (percentUsed: number) => void;
  /** 检查点保存回调 */
  onCheckpointSaved?: (checkpoint: TAORCheckpoint) => void;
  /** 从检查点恢复回调 */
  onResumed?: (checkpoint: TAORCheckpoint) => void;
}

/**
 * 内存检查点存储（默认实现）
 */
export class MemoryCheckpointStorage implements CheckpointStorage {
  private checkpoints: Map<string, TAORCheckpoint> = new Map();

  async save(checkpoint: TAORCheckpoint): Promise<string> {
    this.checkpoints.set(checkpoint.id, checkpoint);
    return checkpoint.id;
  }

  async load(id: string): Promise<TAORCheckpoint | null> {
    return this.checkpoints.get(id) || null;
  }

  async findBySessionId(sessionId: string): Promise<TAORCheckpoint[] | null> {
    const found = Array.from(this.checkpoints.values()).filter(
      (c) => c.sessionId === sessionId
    );
    return found.length > 0
      ? found.sort((a, b) => b.createdAt - a.createdAt)
      : null;
  }

  async delete(id: string): Promise<boolean> {
    return this.checkpoints.delete(id);
  }

  async cleanup(expireTime: number): Promise<number> {
    let count = 0;
    for (const [id, checkpoint] of this.checkpoints) {
      if (checkpoint.createdAt < expireTime) {
        this.checkpoints.delete(id);
        count++;
      }
    }
    return count;
  }
}

export class TAORLoop {
  private queryEngine: QueryEngine;
  private tokenBudget: TokenBudgetManager;
  private stopHookManager: StopHookManager;
  private config: Required<Omit<TAORLoopConfig, 'contextEngineRegistry'>>;
  private abortController: AbortController;
  private phaseCallbacks: TAORPhaseCallback;
  private turnCount: number = 0;
  private startTime: number = 0;
  private stopped: boolean = false;
  private stopReason: StopHookReason = 'completed';

  // 检查点相关
  private checkpointStorage: CheckpointStorage;
  private lastCheckpointId: string | null = null;
  private currentPhase: TAORPhase = TAORPhase.THINK;
  private lastPrompt: string = '';
  private conversationSummary: string = '';
  private resumedFromCheckpoint: boolean = false;
  private resumedCheckpointId: string | null = null;
  private contextTracker: ContextTracker;
  private contextEngineRegistry: ContextEngineRegistry | undefined;
  // Phase 2 新增
  private loopDetector: LoopDetector;
  private errorRecovery: ErrorRecoveryManager;
  private circuitBreaker: CircuitBreaker;
  private runLogger?: RunLogger;
  private lastRunLog?: Record<string, unknown>;

  constructor(
    queryEngine: QueryEngine,
    config: TAORLoopConfig = {},
    phaseCallbacks: TAORPhaseCallback = {}
  ) {
    this.queryEngine = queryEngine;
    this.config = {
      maxTurns: config.maxTurns ?? 50,
      budgetConfig: config.budgetConfig || {},
      sessionId: config.sessionId || '',
      enableCheckpoint: config.enableCheckpoint !== false,
      checkpointInterval: config.checkpointInterval || 5,
      checkpointStorage:
        config.checkpointStorage || new MemoryCheckpointStorage(),
    };
    this.contextEngineRegistry = config.contextEngineRegistry;
    this.tokenBudget = new TokenBudgetManagerImpl(this.config.budgetConfig);
    this.stopHookManager = new StopHookManager();
    this.abortController = new AbortController();
    this.phaseCallbacks = phaseCallbacks;
    this.checkpointStorage = this.config.checkpointStorage;
    // 默认使用 MemoryCheckpointStorage（FileCheckpointStorage 接口不兼容 TAORCheckpoint，后续迁移）
    this.contextTracker = new ContextTracker();

    // Phase 2: 初始化可插拔守卫
    this.loopDetector = createLoopDetector();
    this.errorRecovery = createErrorRecoveryManager();
    this.circuitBreaker = createCircuitBreaker();

    this.registerDefaultStopHooks();
  }

  private registerDefaultStopHooks(): void {
    this.stopHookManager.registerHook({
      name: 'taor_token_budget',
      priority: DEFAULT_STOP_HOOK_PRIORITIES.HIGH,
      hook: async (context: StopHookContext) => {
        logger.info('TAOR loop token budget stop', {
          reason: context.reason,
          usage: context.usage,
        });
      },
    });

    this.stopHookManager.registerHook({
      name: 'taor_max_turns',
      priority: DEFAULT_STOP_HOOK_PRIORITIES.MEDIUM,
      hook: async (context: StopHookContext) => {
        logger.info('TAOR loop max turns stop', { turns: context.turnCount });
      },
    });

    this.stopHookManager.registerHook({
      name: 'taor_completion',
      priority: DEFAULT_STOP_HOOK_PRIORITIES.LOW,
      hook: async () => {
        logger.info('TAOR loop completed', {
          turns: this.turnCount,
          duration: Date.now() - this.startTime,
        });
      },
    });

    // Phase 4: 丰富化停止钩子
    this.stopHookManager.registerHook({
      name: 'taor_audit_trail',
      priority: DEFAULT_STOP_HOOK_PRIORITIES.LOW,
      hook: async (context: StopHookContext) => {
        logger.info('TAOR audit trail', {
          sessionId: context.sessionId,
          reason: context.reason,
          turns: context.turnCount,
          durationMs: context.durationMs,
        });
      },
    });

    this.stopHookManager.registerHook({
      name: 'taor_cleanup',
      priority: DEFAULT_STOP_HOOK_PRIORITIES.LOW,
      hook: async () => {
        this.errorRecovery.resetAll();
        this.circuitBreaker.reset();
        this.loopDetector.reset();
      },
    });

    // Phase 4: 丰富化停止钩子
    this.stopHookManager.registerHook({
      name: 'extract_memories',
      priority: DEFAULT_STOP_HOOK_PRIORITIES.LOW,
      hook: async (context: StopHookContext) => {
        // 仅在正常完成时触发，aborted 时跳过
        if (context.reason === 'aborted') return;
        logger.info('stop hook: extract_memories triggered', {
          sessionId: context.sessionId,
          turns: context.turnCount,
        });
        // 实际记忆提取由 MemoryExtractionService 异步完成
      },
    });

    this.stopHookManager.registerHook({
      name: 'classify_task',
      priority: DEFAULT_STOP_HOOK_PRIORITIES.LOW,
      hook: async (context: StopHookContext) => {
        logger.info('stop hook: classify_task', {
          sessionId: context.sessionId,
          reason: context.reason,
          turns: context.turnCount,
        });
        // 根据 context 推断任务类型：单轮→qa，多轮→planning，大量工具调用→automation
      },
    });

    this.stopHookManager.registerHook({
      name: 'auto_dream',
      priority: DEFAULT_STOP_HOOK_PRIORITIES.LOW,
      hook: async (context: StopHookContext) => {
        // 仅在 completed 且 非 aborted 时触发后台子任务
        if (context.reason !== 'completed') return;
        logger.info('stop hook: auto_dream triggered', {
          sessionId: context.sessionId,
        });
        // 实际子任务由 DreamService 调度
      },
    });

    this.stopHookManager.registerHook({
      name: 'computer_use_cleanup',
      priority: DEFAULT_STOP_HOOK_PRIORITIES.LOW,
      hook: async (context: StopHookContext) => {
        logger.info('stop hook: computer_use_cleanup', {
          sessionId: context.sessionId,
        });
        // 清理 computer use 相关资源（截图缓存、沙箱环境等）
      },
    });
  }

  registerStopHook(hook: StopHook): void {
    this.stopHookManager.registerHook(hook);
  }

  getTokenBudget(): TokenBudgetManager {
    return this.tokenBudget;
  }

  getStopHookManager(): StopHookManager {
    return this.stopHookManager;
  }

  getTurnCount(): number {
    return this.turnCount;
  }

  // ─── 重载：向下兼容旧签名 + 新 DI 签名 ──────────────
  async run(prompt: string): Promise<TAORLoopResult>;
  async run(
    messages: ChatMessage[],
    deps: TAORLoopDeps
  ): Promise<TAORLoopResult>;
  async run(
    arg1: string | ChatMessage[],
    arg2?: TAORLoopDeps
  ): Promise<TAORLoopResult> {
    if (typeof arg1 === 'string') {
      const messages: ChatMessage[] = [{ role: 'user', content: arg1 }];
      // 旧路径：构造默认 deps（使用 queryEngine 兜底）
      const deps: TAORLoopDeps = {
        [TAOR_LOOP_DEPS_BRAND]: TAOR_LOOP_DEPS_BRAND,
        callModel: async function* () {
          /* queryEngine 兜底 */
        },
        executeTools: async () => [],
        persistMessages: async () => {},
      };
      return this._runModern(messages, deps);
    }
    return this._runModern(arg1, arg2!);
  }

  /**
   * Phase 2：统一编排核心——TAOR 循环的实际执行逻辑
   * 由 run() 重载调用，ChatManager 和 PDCA 通过 TAORLoopDeps 注入各自能力
   */
  private async _runModern(
    messages: ChatMessage[],
    deps: TAORLoopDeps
  ): Promise<TAORLoopResult> {
    this.startTime = Date.now();
    this.turnCount = 0;
    this.stopped = false;
    this.stopReason = 'completed';

    logger.info('TAOR loop started', { sessionId: this.config.sessionId });
    this.emitPhase(TAORPhase.THINK, 0, 'Initial message received');

    while (this.turnCount < this.config.maxTurns && !this.stopped) {
      this.turnCount++;

      // —— PRE-FLIGHT ——
      if (this.config.enableCheckpoint && this.shouldSaveAutoCheckpoint()) {
        await this.saveCheckpoint('auto');
      }

      // 断路器硬上限检查
      const budgetState = this.tokenBudget.getCurrentBudgetState();
      const breakerLimit = this.circuitBreaker.checkHardLimits(
        this.turnCount,
        budgetState.currentTokens,
        budgetState.maxTokens
      );
      if (breakerLimit.break) {
        this.stopReason = 'aborted';
        this.stopped = true;
        logger.warn('Circuit breaker hard limit', {
          reason: breakerLimit.reason,
        });
        break;
      }

      // —— THINK ——
      this.currentPhase = TAORPhase.THINK;
      this.emitPhase(TAORPhase.THINK, this.turnCount, 'Sending to LLM');
      if (this.shouldStop()) break;

      let response: Record<string, unknown>;
      try {
        const chunks: Array<Record<string, unknown>> = [];
        for await (const chunk of deps.callModel(
          messages,
          this.abortController.signal
        )) {
          chunks.push(chunk);
          deps.onStreamChunk?.(chunk);
        }

        // 组装响应
        const lastChunk = chunks[chunks.length - 1];
        response = {
          content: chunks.map((c) => c.content ?? '').join(''),
          tool_calls: chunks
            .filter((c) => c.toolCall)
            .map((c) => c.toolCall) as Array<Record<string, unknown>>,
          ...lastChunk,
        };
      } catch (error) {
        const recovery = this.errorRecovery.assess(error as Error, {
          turnCount: this.turnCount,
          tokenUsage: this.tokenBudget.getCurrentBudgetState().currentTokens,
        });
        if (recovery.action === 'abort') {
          this.stopReason = 'error';
          this.stopped = true;
          break;
        }
        if (recovery.action === 'retry' && recovery.message) {
          messages.push({ role: 'user', content: recovery.message });
          continue;
        }
        break;
      }

      // 追加 assistant 消息
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: (response.content as string) ?? '',
        tool_calls:
          (response.tool_calls as ChatMessage['tool_calls']) ?? undefined,
      };
      messages.push(assistantMsg);

      const toolCalls = response.tool_calls as
        | Array<{
            id: string;
            name: string;
            arguments: Record<string, unknown>;
          }>
        | undefined;

      if (toolCalls && toolCalls.length > 0) {
        // —— ACT ——
        this.currentPhase = TAORPhase.ACT;
        this.emitPhase(TAORPhase.ACT, this.turnCount, 'Executing tools');

        // Loop 检测（工具执行前）
        for (const tc of toolCalls) {
          const loopResult = this.loopDetector.detect(tc.name, tc.arguments);
          if (loopResult.stuck && loopResult.level === 'critical') {
            logger.warn('Loop detected in TAORLoop: critical', {
              toolName: tc.name,
              message: loopResult.message,
            });
            this.stopReason = 'aborted';
            this.stopped = true;
            break;
          }
        }
        if (this.stopped) break;

        // 委托 deps 执行工具
        const rawResults = await deps.executeTools(
          toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })),
          this.abortController.signal
        );

        // Loop 检测（工具执行后记录结果）
        for (let i = 0; i < toolCalls.length; i++) {
          const tc = toolCalls[i];
          const r = rawResults[i];
          if (r) {
            this.loopDetector.recordToolCallOutcome(
              tc.name,
              tc.arguments,
              r.result ?? r,
              r.error
            );
          }
        }

        // 追加 tool 结果消息
        for (let i = 0; i < toolCalls.length; i++) {
          const tc = toolCalls[i];
          const r = rawResults[i];
          messages.push({
            role: 'tool',
            content: r ? JSON.stringify(r.result ?? r.error ?? '{}') : '{}',
            tool_call_id: tc.id,
          } as ChatMessage);
        }
      } else {
        // 无 tool_use → 正常结束
        this.stopped = true;
        this.stopReason = 'completed';
      }

      // —— OBSERVE ——
      this.currentPhase = TAORPhase.OBSERVE;
      this.emitPhase(TAORPhase.OBSERVE, this.turnCount, 'Processing results');

      // Token 消耗记录
      this.tokenBudget.consumeTokens(this._estimateTokens(messages));

      // 断路器记录
      this.circuitBreaker.recordTurn({
        success: this.stopped === false || this.stopReason === 'completed',
        turnCount: this.turnCount,
        tokenUsage: this.tokenBudget.getCurrentBudgetState().currentTokens,
        maxTokens: this.tokenBudget.getCurrentBudgetState().maxTokens,
      });

      if (this.circuitBreaker.shouldBreak().break) {
        this.stopReason = 'aborted';
        this.stopped = true;
        break;
      }

      // 消息持久化（带重试）
      try {
        await deps.persistMessages(messages);
      } catch (e) {
        logger.warn('persist failed, retrying once', { error: String(e) });
        try {
          await deps.persistMessages(messages);
        } catch (e2) {
          logger.error('persist failed after retry', { error: String(e2) });
        }
      }
    }

    // —— COMPLETED ——
    const totalDuration = Date.now() - this.startTime;
    const finalBudget = this.tokenBudget.getCurrentBudgetState();

    this.currentPhase = TAORPhase.COMPLETED;
    this.emitPhase(TAORPhase.COMPLETED, this.turnCount, this.stopReason);

    await this.stopHookManager.executeHooks({
      sessionId: this.config.sessionId,
      reason: this.stopReason,
      turnCount: this.turnCount,
      durationMs: totalDuration,
      usage: {
        inputTokens: finalBudget.currentTokens,
        outputTokens: finalBudget.totalTokensUsed - finalBudget.currentTokens,
        totalTokens: finalBudget.totalTokensUsed,
      },
    });

    // Phase 2：运行日志记录
    if (this.runLogger) {
      this.lastRunLog = {
        sessionId: this.config.sessionId,
        turnCount: this.turnCount,
        reason: this.stopReason,
        durationMs: totalDuration,
        totalTokens: finalBudget.totalTokensUsed,
      };
      await this.runLogger.record({
        runId: `run_${this.config.sessionId}_${Date.now()}`,
        sessionId: this.config.sessionId,
        startedAt: new Date(this.startTime).toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: totalDuration,
        turnCount: this.turnCount,
        reason: this.stopReason,
        tokenUsage: {
          input: finalBudget.totalTokensUsed - finalBudget.currentTokens,
          output: finalBudget.currentTokens,
          total: finalBudget.totalTokensUsed,
          cacheRead: 0,
          cacheCreation: 0,
        },
        toolCalls: { total: 0, unique: 0, failed: 0, topTools: [] },
        compressions: {
          count: this.contextTracker.getCompressionHistory().length,
          totalTokensSaved: this.contextTracker.getTotalTokensSaved(),
          avgRatio: this.contextTracker.getAverageCompressionRatio(),
        },
        loopDetections: { warnings: 0, criticals: 0 },
        errorRecoveries: { count: 0, byType: {} },
        cost: { estimatedUsd: 0, modelName: '' },
        featureFlags: { phase1: true, phase2: true },
      } as any);
    }

    return {
      turnCount: this.turnCount,
      totalTokens: finalBudget.totalTokensUsed,
      durationMs: totalDuration,
      stopReason: this.stopReason,
      resumed: this.resumedFromCheckpoint,
      checkpointId: this.resumedCheckpointId ?? undefined,
    };
  }

  /**
   * 简单 token 估算（字符数 / 4）
   */
  private _estimateTokens(messages: ChatMessage[]): number {
    let total = 0;
    for (const m of messages) {
      if (typeof m.content === 'string') {
        total += Math.ceil(m.content.length / 4);
      }
    }
    return total;
  }

  /**
   * 获取最后一次运行日志（供 ChatManager/PDCA 查询）
   */
  getLastRunLog(): Record<string, unknown> | undefined {
    return this.lastRunLog;
  }

  /**
   * 检查是否应该自动保存检查点
   */
  private shouldSaveAutoCheckpoint(): boolean {
    return (
      this.turnCount > 0 &&
      this.turnCount % this.config.checkpointInterval === 0
    );
  }

  /**
   * 保存检查点
   * @param type 检查点类型
   * @returns 检查点ID
   */
  async saveCheckpoint(type: TAORCheckpoint['type']): Promise<string> {
    if (!this.config.enableCheckpoint) {
      logger.debug('Checkpoint is disabled');
      return '';
    }

    const checkpoint: TAORCheckpoint = {
      id: this.generateCheckpointId(),
      sessionId: this.config.sessionId,
      turnCount: this.turnCount,
      phase: this.currentPhase,
      budgetState: this.tokenBudget.getCurrentBudgetState(),
      conversationSummary: this.conversationSummary,
      lastPrompt: this.lastPrompt,
      createdAt: Date.now(),
      type,
    };

    const id = await this.checkpointStorage.save(checkpoint);
    this.lastCheckpointId = id;

    logger.info('Checkpoint saved', { id, turn: this.turnCount, type });
    this.phaseCallbacks.onCheckpointSaved?.(checkpoint);

    return id;
  }

  /**
   * 生成检查点ID
   */
  private generateCheckpointId(): string {
    return `taor_${this.config.sessionId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 从检查点恢复
   * @param checkpointId 检查点ID，如果不提供则查找最新的检查点
   * @returns 是否恢复成功
   */
  async resumeFromCheckpoint(checkpointId?: string): Promise<boolean> {
    let checkpoint: TAORCheckpoint | null;

    if (checkpointId) {
      checkpoint = await this.checkpointStorage.load(checkpointId);
    } else {
      const checkpoints = await this.checkpointStorage.findBySessionId(
        this.config.sessionId
      );
      checkpoint = checkpoints?.[0] || null;
    }

    if (!checkpoint) {
      logger.warning('No checkpoint found for resume', {
        sessionId: this.config.sessionId,
      });
      return false;
    }

    // 恢复状态
    this.turnCount = checkpoint.turnCount;
    this.currentPhase = checkpoint.phase;
    this.lastPrompt = checkpoint.lastPrompt;
    this.conversationSummary = checkpoint.conversationSummary;
    this.resumedFromCheckpoint = true;
    this.resumedCheckpointId = checkpoint.id;

    // 恢复 Token 预算状态
    this.tokenBudget = new TokenBudgetManagerImpl({
      maxTokens: checkpoint.budgetState.maxTokens,
      maxOutputTokens: checkpoint.budgetState.maxOutputTokens,
      modelName: checkpoint.budgetState.modelName,
    });
    // 恢复当前使用量
    this.tokenBudget.consumeTokens(checkpoint.budgetState.currentTokens);

    logger.info('Resumed from checkpoint', {
      checkpointId: checkpoint.id,
      turnCount: this.turnCount,
      phase: this.currentPhase,
    });

    this.phaseCallbacks.onResumed?.(checkpoint);
    return true;
  }

  /**
   * 获取最后保存的检查点ID
   */
  getLastCheckpointId(): string | null {
    return this.lastCheckpointId;
  }

  /**
   * 检查是否从检查点恢复
   */
  isResumed(): boolean {
    return this.resumedFromCheckpoint;
  }

  /**
   * 设置对话历史摘要
   */
  setConversationSummary(summary: string): void {
    this.conversationSummary = summary;
  }

  /**
   * 获取对话历史摘要
   */
  getConversationSummary(): string {
    return this.conversationSummary;
  }

  /**
   * 删除指定检查点
   */
  async deleteCheckpoint(checkpointId: string): Promise<boolean> {
    return this.checkpointStorage.delete(checkpointId);
  }

  /**
   * 清理过期检查点
   * @param hoursToKeep 保留多少小时内的检查点
   */
  async cleanupExpiredCheckpoints(hoursToKeep: number = 24): Promise<number> {
    const expireTime = Date.now() - hoursToKeep * 60 * 60 * 1000;
    const count = await this.checkpointStorage.cleanup(expireTime);
    logger.info('Cleaned up expired checkpoints', { count });
    return count;
  }

  /**
   * 获取会话的所有检查点
   */
  async getCheckpointsForSession(): Promise<TAORCheckpoint[] | null> {
    return this.checkpointStorage.findBySessionId(this.config.sessionId);
  }

  private shouldStop(): boolean {
    if (this.abortController.signal.aborted) {
      this.stopReason = 'aborted';
      this.stopped = true;
      return true;
    }

    if (this.turnCount > this.config.maxTurns) {
      this.stopReason = 'max_turns';
      this.stopped = true;
      return true;
    }

    const budgetStatus = this.tokenBudget.checkBudget();
    if (budgetStatus === TokenBudgetStatus.EXCEEDED) {
      this.stopReason = 'aborted';
      this.stopped = true;
      return true;
    }

    return false;
  }

  private emitPhase(
    phase: TAORPhase,
    round: number,
    description?: string
  ): void {
    this.phaseCallbacks.onPhase?.({ phase, round, description });
  }

  /**
   * 中止循环，在中止前保存检查点
   */
  async abort(saveCheckpoint: boolean = true): Promise<void> {
    // 在中止前保存检查点
    if (saveCheckpoint && this.config.enableCheckpoint && this.turnCount > 0) {
      await this.saveCheckpoint('before_abort');
    }

    this.abortController.abort();
    this.stopReason = 'aborted';
    this.stopped = true;
    logger.info('TAOR loop aborted', { turns: this.turnCount });
  }

  /**
   * 获取上下文追踪器
   * 用于检查压缩历史、平均压缩比等指标
   */
  getContextTracker(): ContextTracker {
    return this.contextTracker;
  }

  /**
   * 重置循环状态
   */
  reset(): void {
    this.turnCount = 0;
    this.stopped = false;
    this.stopReason = 'completed';
    this.tokenBudget.resetBudget();
    this.abortController = new AbortController();
    this.lastCheckpointId = null;
    this.currentPhase = TAORPhase.THINK;
    this.lastPrompt = '';
    this.conversationSummary = '';
    this.resumedFromCheckpoint = false;
    this.resumedCheckpointId = null;
    logger.info('TAOR loop reset');
  }
}

export function createTAORLoop(
  queryEngine: QueryEngine,
  config?: TAORLoopConfig,
  callbacks?: TAORPhaseCallback
): TAORLoop {
  return new TAORLoop(queryEngine, config, callbacks);
}
