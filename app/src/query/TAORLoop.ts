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
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import {
  TokenBudgetController,
  TokenBudgetStatus,
  type TokenBudgetState,
  getDefaultTokenBudget,
} from '../core/tokenBudget/TokenBudgetController.js';
import type { TokenBudgetConfig } from './TokenBudget.js';
import { StopHookManager, DEFAULT_STOP_HOOK_PRIORITIES } from './StopHooks.js';
import type { StopHook, StopHookContext, StopHookReason } from './StopHooks.js';
import type { QueryEngine } from './QueryEngine.js';
import { ContextTracker } from './context/ContextTracker.js';
import type { CompressionRecord } from './context/ContextTracker.js';
import { TAORPhase } from './types.js';
import type { TAORCheckpoint, CheckpointStorage } from './types.js';
import { createLoopDetector } from './LoopDetector.js';
import type { LoopDetector } from './LoopDetector.js';
import { createErrorRecoveryManager } from './ErrorRecoveryManager.js';
import type { ErrorRecoveryManager } from './ErrorRecoveryManager.js';
import { createCircuitBreaker } from './CircuitBreaker.js';
import type { CircuitBreaker } from './CircuitBreaker.js';
import { createRunLogger, RunLogger } from './RunLogger.js';
import { createPathGuard } from './PathGuard.js';
import type { PathGuard } from './PathGuard.js';
import { createFileIOLoopDetector } from './FileIOLoopDetector.js';
import type { FileIOLoopDetector } from './FileIOLoopDetector.js';
import {
  DailyBudgetManager,
  createDailyBudgetManager,
} from './DailyBudgetManager.js';
import { VerifierAgent, createVerifierAgent } from './VerifierAgent.js';
import type { VerifierAgentConfig } from './VerifierAgent.js';
import { FileTAORCheckpointStorage } from './FileTAORCheckpointStorage.js';
import { estimateMessagesTokens } from '../ai/tokenizer/TokenEstimator';
import type { ChatMessage } from '../ai/models/types';

const logger = new Logger({ module: 'query:taorLoop' });

/** trace 持久化用：将值安全截断为 JSON 摘要（默认 500 字符） */
function truncateForTrace(value: unknown, maxLen = 500): string {
  try {
    const s = JSON.stringify(value);
    if (!s) return '';
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
  } catch {
    return String(value).slice(0, maxLen);
  }
}

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
  persistMessages: (
    messages: ChatMessage[],
    signal?: AbortSignal
  ) => Promise<void>;

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

/**
 * 品牌类型模拟值，用于工厂函数构造 TAORLoopDeps
 * 替代 as unknown as TAORLoopDeps 绕过，提供类型安全的构造方式
 */
const TAOR_LOOP_DEPS_BRAND_VALUE = Symbol(
  'TAORLoopDeps'
) as unknown as typeof TAOR_LOOP_DEPS_BRAND;

/**
 * 工厂函数：创建 TAORLoopDeps
 * 替代 as unknown as TAORLoopDeps 绕过，提供类型安全的构造方式
 */
export function createTAORLoopDeps(
  impl: Omit<TAORLoopDeps, typeof TAOR_LOOP_DEPS_BRAND>
): TAORLoopDeps {
  return {
    ...impl,
    [TAOR_LOOP_DEPS_BRAND_VALUE]: TAOR_LOOP_DEPS_BRAND_VALUE,
  } as TAORLoopDeps;
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
  /** 是否启用验证器代理（Phase 4），默认 true */
  enableVerifier?: boolean;
  /** 验证器配置 */
  verifierConfig?: Partial<VerifierAgentConfig>;
  /** Phase 3: VerifierAgent 专用模型调用函数（为 null 则共享主模型） */
  verifierModel?:
    | ((
        messages: Array<{ role: string; content: string }>,
        signal: AbortSignal
      ) => AsyncGenerator<{ content?: string }>)
    | null;
  /** 验证策略（Phase 2b）：AND/OR/TOOL_FIRST */
  verifyStrategy?: 'AND' | 'OR' | 'TOOL_FIRST';
  /** 是否启用自动 verify skill（Phase 2），默认 false */
  enableAutoVerify?: boolean;
  /** 自动验证最大重试次数，默认 3 */
  autoVerifyMaxRetries?: number;
  /** 自动验证超时 ms，默认 15000 */
  autoVerifyTimeoutMs?: number;
  /** Steering 消息队列（mid-turn 注入，不中断当前工具执行） */
  steeringMessages?: string[];
}

// runLogger 不在此接口中（由构造函数单独处理，避免 Required<> 强制）

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
  private tokenBudget: TokenBudgetController;
  private stopHookManager: StopHookManager;
  private config: Required<TAORLoopConfig>;
  private abortController: AbortController;
  private phaseCallbacks: TAORPhaseCallback;
  private turnCount: number = 0;
  private startTime: number = 0;
  private stopped: boolean = false;
  private stopReason: StopHookReason = 'completed';
  /** 上一轮工具执行是否有错误/空结果 — 用于防止静默完成 */
  private _lastRoundHadToolErrors: boolean = false;

  // 检查点相关
  private checkpointStorage: CheckpointStorage;
  private lastCheckpointId: string | null = null;
  private currentPhase: TAORPhase = TAORPhase.THINK;
  private lastPrompt: string = '';
  private conversationSummary: string = '';
  private resumedFromCheckpoint: boolean = false;
  private resumedCheckpointId: string | null = null;
  private contextTracker: ContextTracker;
  // Phase 2 新增
  private loopDetector: LoopDetector;
  private errorRecovery: ErrorRecoveryManager;
  private circuitBreaker: CircuitBreaker;
  private runLogger: RunLogger;
  private lastRunLog?: Record<string, unknown>;
  /** 当前 run 的唯一 ID（trace 持久化关联） */
  private runId: string = '';
  // Phase 1: 路径安全守卫
  private pathGuard: PathGuard;
  // Phase 2: 文件IO循环检测
  private fileIOLoopDetector: FileIOLoopDetector;
  // Phase 3: 日预算管理（收益递减 + 优雅最后一调）
  private dailyBudget: DailyBudgetManager;
  // Phase 4: 验证器代理（制造者/检查者分离）
  private verifier: VerifierAgent;
  // Steering 消息队列（mid-turn 注入）
  private steeringQueue: string[] = [];
  /** Phase 3: 待审批的 Inbox 项列表（保存到 checkpoint） */
  private _pendingInboxItems: Array<{
    itemId: string;
    source: 'permission' | 'pdca' | 'agent_question';
    toolCallId?: string;
    toolName?: string;
  }> = [];
  /** Phase 3: 从 checkpoint 恢复时已预审批的 tool call ID */
  private _preApprovedToolCalls: string[] = [];
  /** Phase 3: Steering 安全过滤器 */
  private readonly _steeringFilter = {
    maxLength: 2000,
    blockedPatterns: [/system:\s*/i, /<\|im_start\|>/i],
  };

  constructor(
    queryEngine: QueryEngine,
    config: TAORLoopConfig = {},
    phaseCallbacks: TAORPhaseCallback = {}
  ) {
    this.queryEngine = queryEngine;
    this.config = {
      maxTurns:
        config.maxTurns ?? (parseInt(process.env.MAX_TAOR_TURNS || '') || 300),
      budgetConfig: config.budgetConfig || {},
      sessionId: config.sessionId || '',
      enableCheckpoint: config.enableCheckpoint !== false,
      checkpointInterval: config.checkpointInterval || 5,
      checkpointStorage:
        config.checkpointStorage || new FileTAORCheckpointStorage(),
      enableVerifier: config.enableVerifier !== false,
      verifierConfig: config.verifierConfig ?? {},
      verifyStrategy: config.verifyStrategy ?? 'AND',
      verifierModel: config.verifierModel ?? null,
      enableAutoVerify: config.enableAutoVerify ?? false,
      autoVerifyMaxRetries: config.autoVerifyMaxRetries ?? 3,
      autoVerifyTimeoutMs: config.autoVerifyTimeoutMs ?? 15000,
      steeringMessages: config.steeringMessages ?? [],
    };
    this.steeringQueue = config.steeringMessages ?? [];
    const model = this.config.budgetConfig.modelName || 'default';
    const defaultBudget = getDefaultTokenBudget(model);
    this.tokenBudget = new TokenBudgetController(
      model,
      {
        total: this.config.budgetConfig.maxTokens || defaultBudget.total,
        remaining:
          this.config.budgetConfig.maxTokens || defaultBudget.remaining,
        maxOutputTokens: this.config.budgetConfig.maxOutputTokens,
      },
      this.config.budgetConfig.maxTokens || defaultBudget.total
    );
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
    // Phase 1: 路径安全守卫
    this.pathGuard = createPathGuard();
    // Phase 2: 文件IO循环检测
    this.fileIOLoopDetector = createFileIOLoopDetector();
    // Phase 3: 日预算管理
    this.dailyBudget = createDailyBudgetManager();
    // Phase 4: 验证器代理（默认启用，可通过 config.set verifier.enabled=false 关闭）
    this.verifier = createVerifierAgent({
      ...config.verifierConfig,
      enabled: config.enableVerifier !== false,
    });
    // Phase 2: 运行日志记录器（默认激活，确保长程任务日志落盘）
    this.runLogger = createRunLogger();

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

  getTokenBudget(): TokenBudgetController {
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
    const otel = getOTelTracing();
    const span = otel.startSpan('taor.run', {
      'session.id': this.config.sessionId,
    });

    try {
      let result: TAORLoopResult;

      if (typeof arg1 === 'string') {
        const messages: ChatMessage[] = [{ role: 'user', content: arg1 }];
        // 旧路径：构造默认 deps（使用 queryEngine 兜底）
        const deps = createTAORLoopDeps({
          callModel: async function* () {
            /* queryEngine 兜底 */
          },
          executeTools: async () => [],
          persistMessages: async () => {},
        });
        result = await this._runModern(messages, deps);
      } else {
        result = await this._runModern(arg1, arg2!);
      }

      span.setAttribute('taor.turns', result.turnCount);
      span.setAttribute('taor.tokens', result.totalTokens);
      span.setAttribute('taor.duration_ms', result.durationMs);
      otel.endSpan(span, SpanStatusCode.OK);
      return result;
    } catch (e) {
      await handleError(e, {
        module: 'query:taorLoop',
        action: 'run',
        context: { sessionId: this.config.sessionId },
      });
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR, String(e));
      throw e;
    }
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
    this.runId = RunLogger.generateRunId(this.config.sessionId);

    // trace：loop start（持久化，不阻塞主循环）
    void this.runLogger.recordTrace({
      type: 'loop',
      runId: this.runId,
      sessionId: this.config.sessionId,
      ts: new Date().toISOString(),
      event: 'start',
    });

    // Phase 4: 注入 callModel 到验证器（支持独立 local 模型）
    if (this.verifier) {
      const modelFn = this.config.verifierModel ?? deps.callModel ?? null;
      if (modelFn) {
        this.verifier.setCallModel(
          modelFn as (
            messages: Array<{ role: string; content: string }>,
            signal: AbortSignal
          ) => AsyncGenerator<{ content?: string }>
        );
      }
    }
    this.verifier.reset();

    logger.info('TAOR loop started', { sessionId: this.config.sessionId });
    this.emitPhase(TAORPhase.THINK, 0, 'Initial message received');

    while (this.turnCount < this.config.maxTurns && !this.stopped) {
      this.turnCount++;

      // —— PRE-FLIGHT ——
      if (this.config.enableCheckpoint && this.shouldSaveAutoCheckpoint()) {
        await this.saveCheckpoint('auto');
        if (this.abortController.signal.aborted) break; // 中断保护
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

      // 预算耗尽检查（Phase 3）：优雅最后一调
      if (!this.dailyBudget.canExecute()) {
        if (this.dailyBudget.needsGraceCall()) {
          logger.warn('预算已耗尽，但允许完成当前工具调用（优雅最后一调）');
        } else {
          this.stopReason = 'budget_exhausted';
          this.stopped = true;
          break;
        }
      }

      // —— THINK ——
      this.currentPhase = TAORPhase.THINK;
      this.emitPhase(TAORPhase.THINK, this.turnCount, 'Sending to LLM');
      if (this.shouldStop()) break;

      // Steering: 注入 mid-turn 消息（不中断当前工具执行，仅影响下一轮 THINK）
      if (this.steeringQueue.length > 0) {
        const steeringMessages = this.steeringQueue.splice(0);
        for (const sm of steeringMessages) {
          messages.push({
            role: 'user',
            content: `[STEERING] ${sm}`,
          });
        }
        logger.info('Steering messages injected', {
          sessionId: this.config.sessionId,
          count: steeringMessages.length,
          turnCount: this.turnCount,
        });
      }

      let response: Record<string, unknown>;
      const otel = getOTelTracing();
      const callModelSpan = otel.startSpan('taor.callModel', {
        turn: this.turnCount,
      });
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
        callModelSpan.end();
      } catch (error) {
        otel.recordError(
          callModelSpan,
          error instanceof Error ? error : new Error(String(error))
        );
        callModelSpan.end();
        await handleError(error, {
          module: 'query:taorLoop',
          action: 'callModel',
          context: {
            turnCount: this.turnCount,
            sessionId: this.config.sessionId,
          },
        });
        const recovery = this.errorRecovery.assess(error as Error, {
          turnCount: this.turnCount,
          tokenUsage: this.tokenBudget.getCurrentBudgetState().currentTokens,
        });
        if (recovery.action === 'abort') {
          this.stopReason = 'error';
          this.stopped = true;
          break;
        }
        if (recovery.action === 'compact_and_retry') {
          logger.info('Context overflow detected, compacting before retry', {
            sessionId: this.config.sessionId,
            turnCount: this.turnCount,
          });
          if (this.config.sessionId) {
            await this.queryEngine.compactIfNeeded(this.config.sessionId);
          }
          if (recovery.message) {
            messages.push({ role: 'user', content: recovery.message });
          }
          continue;
        }
        if (recovery.action === 'retry' && recovery.message) {
          messages.push({ role: 'user', content: recovery.message });
          continue;
        }
        // 防御性兜底：未处理的 action
        logger.warn('Unhandled recovery action in TAORLoop', {
          action: recovery.action,
          sessionId: this.config.sessionId,
          turnCount: this.turnCount,
        });
        this.stopReason = 'error';
        this.stopped = true;
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

      // Fallback: API 未返回结构化 tool_calls 时，尝试从文本中解析 XML-格式工具调用
      // 覆盖 <tool_call> / <invoke> / <function_call> 等格式
      let fallbackToolCalls:
        | Array<{
            id: string;
            name: string;
            arguments: Record<string, unknown>;
          }>
        | undefined;

      if (!toolCalls || toolCalls.length === 0) {
        const content = (response.content as string) ?? '';
        const { parserRegistry } = await import('../ai/parsers/ParserRegistry');
        const parsed = parserRegistry.parseFallback(content);
        if (parsed.toolCalls && parsed.toolCalls.length > 0) {
          fallbackToolCalls = parsed.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments:
              typeof tc.arguments === 'string'
                ? (JSON.parse(tc.arguments) as Record<string, unknown>)
                : (tc.arguments as Record<string, unknown>),
          }));
          // 用剥离标签后的内容替换 assistant 消息
          const cleanContent = parsed.content ?? '';
          if (cleanContent !== content) {
            messages[messages.length - 1] = {
              role: 'assistant',
              content: cleanContent,
              tool_calls:
                fallbackToolCalls as unknown as ChatMessage['tool_calls'],
            };
          }
          logger.info('Fallback parser 提取到工具调用', {
            sessionId: this.config.sessionId,
            turnCount: this.turnCount,
            toolCount: fallbackToolCalls.length,
            toolNames: fallbackToolCalls.map((t) => t.name),
          });
        }
      }

      const effectiveToolCalls = toolCalls ?? fallbackToolCalls;

      if (effectiveToolCalls && effectiveToolCalls.length > 0) {
        // —— ACT ——
        this.currentPhase = TAORPhase.ACT;
        this.emitPhase(TAORPhase.ACT, this.turnCount, 'Executing tools');

        // Loop 检测（工具执行前）
        for (const tc of effectiveToolCalls) {
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

        // PathGuard 路径安全守卫（Phase 1）
        for (const tc of effectiveToolCalls) {
          const pathCheck = this.pathGuard.checkToolCall(tc.name, tc.arguments);
          if (!pathCheck.allowed) {
            logger.warn('PathGuard 拦截工具调用', {
              tool: tc.name,
              path: tc.arguments,
              reason: pathCheck.reason,
            });
            this.stopReason = 'aborted';
            this.stopped = true;
            break;
          }
        }
        if (this.stopped) break;

        // FileIOLoopDetector 文件读写循环检测（Phase 2）
        for (const tc of effectiveToolCalls) {
          const args = tc.arguments as Record<string, unknown>;
          const filePath = (args.path ?? args.filePath ?? args.directory) as
            | string
            | undefined;

          if (filePath) {
            const ioCheck = this.fileIOLoopDetector.checkBeforeAccess(
              tc.name,
              filePath,
              args.offset as number | undefined,
              args.limit as number | undefined
            );

            if (ioCheck.blocked) {
              logger.warn('文件IO循环已被阻止', {
                tool: tc.name,
                path: filePath,
              });
              this.stopReason = 'aborted';
              this.stopped = true;
              break;
            }

            if (ioCheck.warning) {
              logger.warn('文件IO循环警告', { tool: tc.name, path: filePath });
            }
          }
        }
        if (this.stopped) break;

        // 委托 deps 执行工具（带异常保护）
        const otel = getOTelTracing();
        const execSpan = otel.startSpan('taor.executeTools', {
          turn: this.turnCount,
          'tool.count': effectiveToolCalls.length,
        });
        // trace：每个工具调用开始（enter）
        const toolStartTs = Date.now();
        for (const tc of effectiveToolCalls) {
          void this.runLogger.recordTrace({
            type: 'tool',
            runId: this.runId,
            sessionId: this.config.sessionId,
            ts: new Date().toISOString(),
            turn: this.turnCount,
            name: tc.name,
            argsHead: truncateForTrace(tc.arguments),
            status: 'enter',
          });
        }
        let rawResults: Array<{
          toolCallId?: string;
          toolName?: string;
          result?: unknown;
          error?: string;
        }>;
        try {
          rawResults = await deps.executeTools(
            effectiveToolCalls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            })),
            this.abortController.signal
          );
          execSpan.end();
        } catch (execErr) {
          otel.recordError(
            execSpan,
            execErr instanceof Error ? execErr : new Error(String(execErr))
          );
          execSpan.end();
          await handleError(execErr, {
            module: 'query:taorLoop',
            action: 'executeTools_batch',
            context: {
              sessionId: this.config.sessionId,
              turnCount: this.turnCount,
              toolCount: effectiveToolCalls.length,
            },
          });
          // 构造错误结果，不丢失工具调用信息
          rawResults = effectiveToolCalls.map((tc) => ({
            toolCallId: tc.id,
            toolName: tc.name,
            error: `工具执行异常: ${execErr instanceof Error ? execErr.message.slice(0, 300) : String(execErr).slice(0, 300)}`,
          }));
          // 注入系统提示，让 LLM 知道发生了什么
          messages.push({
            role: 'user',
            content: `[SYSTEM] 上一轮 ${effectiveToolCalls.length} 个工具调用在执行阶段发生异常，请告知用户遇到了什么问题，并根据当前已完成的部分给出总结或建议下一步操作。`,
          } as ChatMessage);
        }
        // trace：每个工具调用结束（ok/error，含耗时与结果摘要）
        for (let i = 0; i < effectiveToolCalls.length; i++) {
          const tc = effectiveToolCalls[i];
          const r = rawResults[i];
          void this.runLogger.recordTrace({
            type: 'tool',
            runId: this.runId,
            sessionId: this.config.sessionId,
            ts: new Date().toISOString(),
            turn: this.turnCount,
            name: tc.name,
            status: r?.error ? 'error' : 'ok',
            durationMs: Date.now() - toolStartTs,
            resultHead: r ? truncateForTrace(r.result ?? r) : undefined,
            error: r?.error ? String(r.error).slice(0, 500) : undefined,
          });
        }

        // Loop 检测（工具执行后记录结果）
        for (let i = 0; i < effectiveToolCalls.length; i++) {
          const tc = effectiveToolCalls[i];
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
        let roundHadErrors = false;
        for (let i = 0; i < effectiveToolCalls.length; i++) {
          const tc = effectiveToolCalls[i];
          const r = rawResults[i];
          const hasError = !r || r.error;
          const isEmpty =
            r && !r.error && (r.result === null || r.result === undefined);
          if (hasError || isEmpty) {
            roundHadErrors = true;
          }
          messages.push({
            role: 'tool',
            content: r
              ? JSON.stringify(
                  r.result ??
                    r.error ?? {
                      _toolError: 'empty_result',
                      hint: '工具未返回有效结果，请告知用户遇到了什么问题',
                    }
                )
              : JSON.stringify({
                  _toolError: 'no_result',
                  hint: '工具调用失败，未获取到任何结果，请告知用户',
                }),
            tool_call_id: tc.id,
          } as ChatMessage);
        }
        this._lastRoundHadToolErrors = roundHadErrors;

        // 全局断路器记录（Phase 2）：同调用+同结果追踪
        for (let i = 0; i < effectiveToolCalls.length; i++) {
          const tc = effectiveToolCalls[i];
          const r = rawResults[i];
          if (r && !r.error) {
            const argsHash =
              String(tc.name) +
              ':' +
              JSON.stringify(tc.arguments).slice(0, 500);
            const resultHash = JSON.stringify(r.result ?? r).slice(0, 500);
            const breakerResult = this.circuitBreaker.recordSameCallResult(
              tc.name,
              argsHash,
              resultHash
            );
            if (breakerResult.break) {
              logger.warn('全局断路器触发', {
                tool: tc.name,
                reason: breakerResult.reason,
              });
              this.stopReason = 'aborted';
              this.stopped = true;
              break;
            }
          }
        }
        if (this.stopped) break;

        // Phase 2: Auto-verify（机械验证：编译/测试/TODO扫描）
        // 2026-08-06：原 import skills/builtin/verify.js 绕过技能体系直连假 skill，
        // 归一化为直接调用 query/verifyProject.ts 工具函数。
        let toolVerifyPassed = true;
        if (this.config.enableAutoVerify) {
          try {
            const { verifyProject } = await import('./verifyProject.js');
            const verifyPromise = verifyProject();
            const verifyResult = await Promise.race([
              verifyPromise,
              new Promise<string>((_, reject) =>
                setTimeout(
                  () => reject(new Error('verify_timeout')),
                  this.config.autoVerifyTimeoutMs
                )
              ),
            ]).catch((err) => {
              logger.warn('Auto-verify skipped', { reason: err.message });
              return 'SKIPPED';
            });

            if (
              verifyResult !== 'SKIPPED' &&
              typeof verifyResult === 'string'
            ) {
              toolVerifyPassed =
                verifyResult.includes('✅') && !verifyResult.includes('❌');
              logger.info('Auto-verify result', {
                passed: toolVerifyPassed,
                phases: this.config.verifyStrategy,
              });
            }
          } catch (verifyErr) {
            logger.warn('Auto-verify failed', { error: String(verifyErr) });
            toolVerifyPassed = true; // 异常时跳过，不阻塞
          }
        }

        // Phase 2b: VerifyStrategy 仲裁
        if (this.config.verifyStrategy === 'AND') {
          if (!toolVerifyPassed) {
            logger.warn(
              'VerifyStrategy=AND: tool verify failed, skipping VerifierAgent'
            );
            messages.push({
              role: 'user',
              content:
                '[SYSTEM] 自动验证未通过（编译/测试失败），请修复后重新执行。',
            } as ChatMessage);
            continue; // 回到 THINK 阶段
          }
        } else if (this.config.verifyStrategy === 'TOOL_FIRST') {
          if (toolVerifyPassed) {
            // Tool verify 通过，跳过 VerifierAgent（省钱）
            continue; // 跳过 VerifierAgent，直接到下一轮或结束
          }
          // Tool verify 失败，继续走 VerifierAgent
        }
        // OR 模式：任一通过即可，继续走 VerifierAgent

        // Phase 4: 验证器代理（制造者/检查者分离）
        if (this.verifier) {
          const verificationInput = {
            messages: messages.map((m) => ({
              role: m.role,
              content:
                typeof m.content === 'string'
                  ? m.content
                  : JSON.stringify(m.content),
              tool_calls: m.tool_calls,
              tool_call_id: m.tool_call_id,
            })),
            toolResults: effectiveToolCalls.map((tc, i) => ({
              toolName: tc.name,
              toolCallId: tc.id,
              result: rawResults[i]?.result,
              error: rawResults[i]?.error,
            })),
            turnCount: this.turnCount,
            sessionId: this.config.sessionId,
          };

          const verification = await this.verifier.verify(
            verificationInput,
            this.abortController.signal
          );

          if (!verification.passed) {
            if (verification.verdict === 'ESCALATE') {
              logger.warn('验证器升级：无法确定修改正确性', {
                sessionId: this.config.sessionId,
                feedback: verification.feedback,
                cycleCount: this.verifier.getCycleCount(),
              });
              this.stopReason = 'verifier_escalate';
              this.stopped = true;
              break;
            }

            if (verification.verdict === 'REJECT') {
              logger.warn('验证器拒绝：修改未通过审查', {
                sessionId: this.config.sessionId,
                feedback: verification.feedback,
                cycleCount: this.verifier.getCycleCount(),
              });

              if (verification.feedback) {
                messages.push({
                  role: 'user',
                  content: `[验证器反馈] ${verification.feedback}\n\n请根据以上反馈修复问题，然后重新执行验证。`,
                } as ChatMessage);
              }
              // 不 break，让循环继续（制造者修复后重新验证）
              continue;
            }
          }

          logger.debug('验证器通过', {
            sessionId: this.config.sessionId,
            confidence: verification.confidence,
          });
        }
      } else {
        // 无 tool_use → 检查上一轮是否有工具错误被静默吞掉
        if (this._lastRoundHadToolErrors && this.turnCount > 1) {
          logger.warn('TAOR: 工具错误后 LLM 尝试静默结束，注入提醒', {
            sessionId: this.config.sessionId,
            turnCount: this.turnCount,
          });
          messages.push({
            role: 'user',
            content:
              '[系统提示] 上一轮工具调用返回了错误或空结果。如果你因工具失败无法继续任务，请明确告知用户遇到了什么问题、需要用户提供什么信息，不要直接结束对话。',
          });
          this._lastRoundHadToolErrors = false;
          continue; // 再给 LLM 一次机会处理错误
        }

        // 正常结束
        this.stopped = true;
        this.stopReason = 'completed';
      }

      // —— OBSERVE ——
      this.currentPhase = TAORPhase.OBSERVE;
      this.emitPhase(TAORPhase.OBSERVE, this.turnCount, 'Processing results');

      // no_tool_call 纯文本死循环检测（Phase 2）
      this.loopDetector.recordTurn((toolCalls?.length ?? 0) > 0);
      const noToolCallResult = this.loopDetector.detectNoToolCallLoop();
      if (noToolCallResult.stuck && noToolCallResult.level === 'critical') {
        logger.warn('no_tool_call 死循环检测触发', {
          message: noToolCallResult.message,
        });
        this.stopReason = 'aborted';
        this.stopped = true;
        break;
      }

      // Token 消耗记录
      this.tokenBudget.consumeTokens(this._estimateTokens(messages));

      // 检查 Token 预算状态，触发 WARNING/CRITICAL 回调
      const currentBudgetState = this.tokenBudget.getCurrentBudgetState();
      if (
        currentBudgetState.status === TokenBudgetStatus.WARNING ||
        currentBudgetState.status === TokenBudgetStatus.CRITICAL
      ) {
        const percentUsed = currentBudgetState.percentUsed || 0;
        this.phaseCallbacks.onBudgetWarning?.(percentUsed);

        // 触发上下文压缩（中断保护）
        if (this.config.sessionId && !this.abortController.signal.aborted) {
          await this.queryEngine.compactIfNeeded(this.config.sessionId);
        }
      }

      // 断路器记录
      this.circuitBreaker.recordTurn({
        success: this.stopped === false || this.stopReason === 'completed',
        turnCount: this.turnCount,
        tokenUsage: currentBudgetState.currentTokens,
        maxTokens: currentBudgetState.maxTokens,
      });

      if (this.circuitBreaker.shouldBreak().break) {
        this.stopReason = 'aborted';
        this.stopped = true;
        break;
      }

      // 收益递减检测（Phase 3）
      const totalTokens = currentBudgetState.currentTokens;
      const diminishingCheck =
        this.dailyBudget.checkDiminishingReturns(totalTokens);
      if (diminishingCheck.diminishing) {
        logger.warn('收益递减，终止循环', { reason: diminishingCheck.reason });
        this.stopReason = 'diminishing_returns';
        this.stopped = true;
        break;
      }

      // 消息持久化（带重试 + 中断保护）
      try {
        await deps.persistMessages(messages, this.abortController.signal);
      } catch (e) {
        await handleError(e, {
          module: 'query:taorLoop',
          action: 'persistMessages_first',
          context: {
            sessionId: this.config.sessionId,
            turnCount: this.turnCount,
          },
        });
        logger.warn('persist failed, retrying once', { error: String(e) });
        try {
          await deps.persistMessages(messages, this.abortController.signal);
        } catch (e2) {
          await handleError(e2, {
            module: 'query:taorLoop',
            action: 'persistMessages_retry',
            context: {
              sessionId: this.config.sessionId,
              turnCount: this.turnCount,
            },
          });
        }
      }
    }

    // —— COMPLETED ——
    const totalDuration = Date.now() - this.startTime;
    const finalBudget = this.tokenBudget.getCurrentBudgetState();

    this.currentPhase = TAORPhase.COMPLETED;
    this.emitPhase(TAORPhase.COMPLETED, this.turnCount, this.stopReason);

    // trace：loop end（持久化，含汇总指标）
    void this.runLogger.recordTrace({
      type: 'loop',
      runId: this.runId,
      sessionId: this.config.sessionId,
      ts: new Date().toISOString(),
      event: 'end',
      status: this.stopReason,
      durationMs: totalDuration,
    });

    // Durable Resume: 非正常完成时自动保存检查点
    if (this.config.enableCheckpoint && this.stopReason !== 'completed') {
      try {
        await this.saveCheckpoint('before_abort');
        logger.info('Durable checkpoint saved on stop', {
          sessionId: this.config.sessionId,
          stopReason: this.stopReason,
          turnCount: this.turnCount,
        });
      } catch (e) {
        // 检查点保存失败不阻塞主流程（非关键路径）
        logger.warn('Durable checkpoint save failed', { error: String(e) });
      }
    }

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
        runId: this.runId || `run_${this.config.sessionId}_${Date.now()}`,
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
      } as unknown as Parameters<typeof this.runLogger.record>[0]);
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
   * Token 估算：使用 estimateMessagesTokens（tiktoken + CJK + role overhead）
   */
  private _estimateTokens(messages: ChatMessage[]): number {
    return estimateMessagesTokens(messages);
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
      breakerState: this.circuitBreaker.getState(),
      loopDetectorState: this.loopDetector.getState(),
      errorRecoveryState: this.errorRecovery.serialize(),
      // Phase 3: 检查点扩展字段
      pendingToolCalls: undefined,
      messageCount: this.turnCount,
    };

    // Phase 3: 检查点关联的 Inbox 状态
    if (this._pendingInboxItems && this._pendingInboxItems.length > 0) {
      checkpoint.inboxState = {
        pendingInboxItems: this._pendingInboxItems.map((item) => ({
          itemId: item.itemId,
          source: item.source,
          status: 'pending' as const,
          toolCallId: item.toolCallId,
          toolName: item.toolName,
        })),
      };
    }

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

    // 恢复 Token 预算状态（向后兼容：旧 checkpoint 可能无 currentTokens 字段）
    const currentTokens = checkpoint.budgetState.currentTokens ?? 0;
    const actualRemaining = Math.max(
      0,
      checkpoint.budgetState.maxTokens - currentTokens
    );
    this.tokenBudget = new TokenBudgetController(
      checkpoint.budgetState.modelName,
      {
        total: checkpoint.budgetState.maxTokens,
        remaining: actualRemaining,
        maxOutputTokens: checkpoint.budgetState.maxOutputTokens,
      },
      checkpoint.budgetState.maxTokens
    );

    // 恢复断路器状态
    if (checkpoint.breakerState) {
      this.circuitBreaker.restoreState(
        checkpoint.breakerState as ReturnType<
          typeof this.circuitBreaker.getState
        >
      );
    }
    // 恢复循环检测器状态
    if (checkpoint.loopDetectorState) {
      this.loopDetector.restoreState(checkpoint.loopDetectorState);
    }
    // 恢复错误恢复管理器状态
    if (checkpoint.errorRecoveryState) {
      this.errorRecovery.restore(
        checkpoint.errorRecoveryState as Parameters<
          typeof this.errorRecovery.restore
        >[0]
      );
    }

    // Phase 3: 恢复 Inbox 联动状态 — 检查已审批的项
    if (
      checkpoint.inboxState &&
      checkpoint.inboxState.pendingInboxItems.length > 0
    ) {
      try {
        const { inboxManager } =
          await import('@modules/runtime/InboxManager.js');
        const approvedToolCalls: string[] = [];
        for (const item of checkpoint.inboxState.pendingInboxItems) {
          const current = await inboxManager.get(item.itemId);
          if (
            current &&
            current.status === 'replied' &&
            current.reply === 'approve'
          ) {
            logger.info('Resumed with pre-approved inbox item', {
              itemId: item.itemId,
              toolName: item.toolName,
            });
            if (item.toolCallId) {
              approvedToolCalls.push(item.toolCallId);
            }
          }
        }
        if (approvedToolCalls.length > 0) {
          this._preApprovedToolCalls = approvedToolCalls;
        }
      } catch (inboxErr) {
        logger.warn('Failed to check inbox status during resume', {
          error: String(inboxErr),
        });
      }
    }

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
    // trace：每个阶段步骤记录（持久化，fire-and-forget 不阻塞主循环）
    if (this.runId) {
      void this.runLogger.recordTrace({
        type: 'step',
        runId: this.runId,
        sessionId: this.config.sessionId,
        ts: new Date().toISOString(),
        turn: round,
        phase,
        name: phase,
        description,
        status: 'enter',
      });
    }
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
   * Steering 注入：在运行中向 Agent 发送新指令
   * 不中断当前工具执行，消息将在下一轮 THINK 阶段注入
   */
  injectSteering(message: string): void {
    // 安全检查
    if (message.length > this._steeringFilter.maxLength) {
      logger.warn('Steering message rejected: too long', {
        length: message.length,
      });
      return;
    }
    for (const pattern of this._steeringFilter.blockedPatterns) {
      if (pattern.test(message)) {
        logger.warn('Steering message rejected: blocked content', {
          pattern: pattern.source,
        });
        return;
      }
    }

    // 标记为 steering role（区分系统注入和正常对话）
    const marked = `[steering]\n${message}`;
    this.steeringQueue.push(marked);
    logger.info('Steering message queued', {
      sessionId: this.config.sessionId,
      queueLength: this.steeringQueue.length,
    });
  }

  /**
   * 注册待审批的 Inbox 项（Phase 3: Resume+Inbox 联动）
   * 工具审批提交到 Inbox 时调用，用于 checkpoint 保存和恢复联动
   */
  addPendingInboxItem(item: {
    itemId: string;
    source: 'permission' | 'pdca' | 'agent_question';
    toolCallId?: string;
    toolName?: string;
  }): void {
    this._pendingInboxItems.push(item);
    logger.debug('Pending inbox item registered', {
      itemId: item.itemId,
      source: item.source,
    });
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
    this.steeringQueue = [];
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
