/**
 * TAOR (Think-Act-Observe-Repeat) 循环编排器
 * 在 QueryEngine 基础上提供完整的 TAOR 生命周期管理
 * 整合 TokenBudget、StopHooks、ToolCallPartitioner
 * 支持中断恢复（checkpoint/resume）机制
 */

import { Logger } from '@modules/monitoring/logs/Logger';
import { TokenBudgetManagerImpl, TokenBudgetStatus } from './TokenBudget.js';
import type { TokenBudgetConfig, TokenBudgetManager, TokenBudgetState } from './TokenBudget.js';
import { StopHookManager, DEFAULT_STOP_HOOK_PRIORITIES } from './StopHooks.js';
import type { StopHook, StopHookContext, StopHookReason } from './StopHooks.js';
import type { QueryEngine } from './QueryEngine.js';

const logger = new Logger();

export enum TAORPhase {
  THINK = 'think',
  ACT = 'act',
  OBSERVE = 'observe',
  COMPLETED = 'completed',
}

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
 * TAOR检查点数据结构
 */
export interface TAORCheckpoint {
  /** 检查点唯一标识 */
  id: string;
  /** 会话ID */
  sessionId: string;
  /** 当前轮次 */
  turnCount: number;
  /** 当前阶段 */
  phase: TAORPhase;
  /** Token预算状态 */
  budgetState: TokenBudgetState;
  /** 对话历史摘要 */
  conversationSummary: string;
  /** 最后提示 */
  lastPrompt: string;
  /** 创建时间 */
  createdAt: number;
  /** 检查点类型 */
  type: 'auto' | 'manual' | 'before_abort';
}

/**
 * 检查点存储接口
 */
export interface CheckpointStorage {
  /** 保存检查点 */
  save(checkpoint: TAORCheckpoint): Promise<string>;
  /** 根据ID加载检查点 */
  load(id: string): Promise<TAORCheckpoint | null>;
  /** 根据会话ID查找检查点 */
  findBySessionId(sessionId: string): Promise<TAORCheckpoint[] | null>;
  /** 删除检查点 */
  delete(id: string): Promise<boolean>;
  /** 清理过期检查点 */
  cleanup(expireTime: number): Promise<number>;
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
    return found.length > 0 ? found.sort((a, b) => b.createdAt - a.createdAt) : null;
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
  private config: Required<TAORLoopConfig>;
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
      checkpointStorage: config.checkpointStorage || new MemoryCheckpointStorage(),
    };
    this.tokenBudget = new TokenBudgetManagerImpl(this.config.budgetConfig);
    this.stopHookManager = new StopHookManager();
    this.abortController = new AbortController();
    this.phaseCallbacks = phaseCallbacks;
    this.checkpointStorage = this.config.checkpointStorage;

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

  async run(prompt: string): Promise<TAORLoopResult> {
    this.startTime = Date.now();
    this.turnCount = 0;
    this.stopped = false;
    this.stopReason = 'completed';
    this.lastPrompt = prompt;

    logger.info('TAOR loop started', { sessionId: this.config.sessionId });

    this.emitPhase(TAORPhase.THINK, 0, 'Initial prompt received');

    while (this.turnCount < this.config.maxTurns && !this.stopped) {
      this.turnCount++;

      // 检查是否需要自动保存检查点
      if (this.config.enableCheckpoint && this.shouldSaveAutoCheckpoint()) {
        await this.saveCheckpoint('auto');
      }

      this.currentPhase = TAORPhase.THINK;
      this.emitPhase(TAORPhase.THINK, this.turnCount, 'Sending to LLM');

      if (this.shouldStop()) break;

      this.currentPhase = TAORPhase.ACT;
      this.emitPhase(TAORPhase.ACT, this.turnCount, 'Executing tools');

      if (this.shouldStop()) break;

      this.currentPhase = TAORPhase.OBSERVE;
      this.emitPhase(TAORPhase.OBSERVE, this.turnCount, 'Processing results');

      const budget = this.tokenBudget.getCurrentBudgetState();
      if (budget.status === TokenBudgetStatus.WARNING) {
        this.phaseCallbacks.onBudgetWarning?.(budget.percentUsed);
        await this.queryEngine.compactIfNeeded(this.config.sessionId);
      }
    }

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

    logger.info('TAOR loop finished', {
      turns: this.turnCount,
      duration: totalDuration,
      reason: this.stopReason,
      tokens: finalBudget.totalTokensUsed,
    });

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
   * 检查是否应该自动保存检查点
   */
  private shouldSaveAutoCheckpoint(): boolean {
    return (
      this.turnCount > 0 && this.turnCount % this.config.checkpointInterval === 0
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
      logger.warning('No checkpoint found for resume', { sessionId: this.config.sessionId });
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
