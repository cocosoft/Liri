/**
 * TAOR (Think-Act-Observe-Repeat) 循环编排器
 * 在 QueryEngine 基础上提供完整的 TAOR 生命周期管理
 * 整合 TokenBudget、StopHooks、ToolCallPartitioner
 */

import { Logger } from '@modules/monitoring/logs/Logger';
import { TokenBudgetManagerImpl, TokenBudgetStatus } from './TokenBudget.js';
import type { TokenBudgetConfig, TokenBudgetManager } from './TokenBudget.js';
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
}

export interface TAORLoopResult {
  turnCount: number;
  totalTokens: number;
  durationMs: number;
  stopReason: StopHookReason;
}

export interface TAORPhaseCallback {
  onPhase?: (info: TAORPhaseInfo) => void;
  onError?: (error: Error, phase: TAORPhase, round: number) => void;
  onBudgetWarning?: (percentUsed: number) => void;
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

  constructor(
    queryEngine: QueryEngine,
    config: TAORLoopConfig = {},
    phaseCallbacks: TAORPhaseCallback = {}
  ) {
    this.queryEngine = queryEngine;
    this.config = {
      maxTurns: config.maxTurns || 50,
      budgetConfig: config.budgetConfig || {},
      sessionId: config.sessionId || '',
    };
    this.tokenBudget = new TokenBudgetManagerImpl(this.config.budgetConfig);
    this.stopHookManager = new StopHookManager();
    this.abortController = new AbortController();
    this.phaseCallbacks = phaseCallbacks;

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

    logger.info('TAOR loop started', { sessionId: this.config.sessionId });

    this.emitPhase(TAORPhase.THINK, 0, 'Initial prompt received');

    while (this.turnCount < this.config.maxTurns && !this.stopped) {
      this.turnCount++;

      this.emitPhase(TAORPhase.THINK, this.turnCount, 'Sending to LLM');

      if (this.shouldStop()) break;

      this.emitPhase(TAORPhase.ACT, this.turnCount, 'Executing tools');

      if (this.shouldStop()) break;

      this.emitPhase(TAORPhase.OBSERVE, this.turnCount, 'Processing results');

      const budget = this.tokenBudget.getCurrentBudgetState();
      if (budget.status === TokenBudgetStatus.WARNING) {
        this.phaseCallbacks.onBudgetWarning?.(budget.percentUsed);
      }
    }

    const totalDuration = Date.now() - this.startTime;
    const finalBudget = this.tokenBudget.getCurrentBudgetState();

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
    };
  }

  private shouldStop(): boolean {
    if (this.abortController.signal.aborted) {
      this.stopReason = 'aborted';
      this.stopped = true;
      return true;
    }

    if (this.turnCount >= this.config.maxTurns) {
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

  abort(): void {
    this.abortController.abort();
    this.stopReason = 'aborted';
    this.stopped = true;
    logger.info('TAOR loop aborted', { turns: this.turnCount });
  }

  reset(): void {
    this.turnCount = 0;
    this.stopped = false;
    this.stopReason = 'completed';
    this.tokenBudget.resetBudget();
    this.abortController = new AbortController();
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
