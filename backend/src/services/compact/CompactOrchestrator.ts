/**
 * 统一压缩编排器
 * 集成 autoCompact / reactiveCompact / microcompact 三种策略
 * 所有压缩操作记录原始 Token 数和压缩后 Token 数
 */

import type { SessionMessage } from '@modules/session/models/SessionMessage';
import type { Message } from '@modules/chat/types/message';
import { shouldAutoCompact, CompactCircuitBreaker } from './autoCompact';
import { ReactiveCompactService } from './reactiveCompact';
import { evaluateTimeBasedTrigger } from './microCompact';
import { roughTokenCountEstimationForMessages } from './utils';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export interface CompactRecord {
  strategy: 'auto' | 'reactive' | 'micro' | 'none';
  timestamp: Date;
  originalTokenCount: number;
  compressedTokenCount: number;
  reductionRatio: number;
  sessionId: string;
  success: boolean;
}

export interface CompactOrchestratorOptions {
  autoCompactThreshold?: number;
  reactiveGrowthThreshold?: number;
  reactiveRoundsThreshold?: number;
  microCompactEnabled?: boolean;
  maxCompactsPerMinute?: number;
  verbose?: boolean;
}

const DEFAULT_OPTIONS: CompactOrchestratorOptions = {
  autoCompactThreshold: 0.8,
  reactiveGrowthThreshold: 0.15,
  reactiveRoundsThreshold: 3,
  microCompactEnabled: true,
  maxCompactsPerMinute: 10,
  verbose: false,
};

function toSessionMessages(messages: Message[]): SessionMessage[] {
  return messages as unknown as SessionMessage[];
}

export class CompactOrchestrator {
  private reactiveService: ReactiveCompactService;
  private circuitBreaker: CompactCircuitBreaker;
  private compactHistory: Map<string, CompactRecord[]> = new Map();
  private options: CompactOrchestratorOptions;

  constructor(
    private compactService: any,
    options?: Partial<CompactOrchestratorOptions>
  ) {
    this.reactiveService = new ReactiveCompactService(compactService);
    this.circuitBreaker = new CompactCircuitBreaker();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  shouldCompact(
    sessionId: string,
    messages: Message[],
    model: string,
    querySource?: string
  ): { shouldCompact: boolean; strategy: string; reason: string } {
    if (!this.circuitBreaker.canCompact()) {
      return { shouldCompact: false, strategy: 'none', reason: 'Circuit breaker open' };
    }

    const sessionMessages = toSessionMessages(messages);
    const autoCheck = shouldAutoCompact(
      roughTokenCountEstimationForMessages(sessionMessages),
      model
    );
    if (autoCheck.shouldCompact) {
      return { shouldCompact: true, strategy: 'auto', reason: 'Token threshold exceeded' };
    }

    const reactiveCheck = this.reactiveService.shouldCompactReactively(
      sessionId,
      sessionMessages,
      model
    );
    if (reactiveCheck.shouldCompact) {
      return { shouldCompact: true, strategy: 'reactive', reason: reactiveCheck.reason };
    }

    if (this.options.microCompactEnabled) {
      const microCheck = this.shouldMicrocompact(sessionMessages, querySource);
      if (microCheck) {
        return { shouldCompact: true, strategy: 'micro', reason: 'Time-based trigger' };
      }
    }

    return { shouldCompact: false, strategy: 'none', reason: 'No strategy triggered' };
  }

  async compact(
    sessionId: string,
    messages: Message[],
    model: string,
    querySource?: string
  ): Promise<{
    strategy: string;
    success: boolean;
    result?: any;
    record: CompactRecord;
  }> {
    const sessionMessages = toSessionMessages(messages);
    const originalTokenCount = roughTokenCountEstimationForMessages(sessionMessages);

    const decision = this.shouldCompact(sessionId, messages, model, querySource);
    if (!decision.shouldCompact) {
      return {
        strategy: 'none',
        success: false,
        record: {
          strategy: 'none',
          timestamp: new Date(),
          originalTokenCount,
          compressedTokenCount: originalTokenCount,
          reductionRatio: 0,
          sessionId,
          success: true,
        },
      };
    }

    try {
      let result: any;
      let compressedTokenCount = originalTokenCount;

      switch (decision.strategy) {
        case 'auto': {
          const autoService = new (await import('./AutoCompactService')).AutoCompactService();
          const autoResult = await autoService.performAutoCompact(
            sessionId,
            messages,
            model
          );
          result = autoResult;
          compressedTokenCount = autoResult.result
            ? autoResult.result.preCompactTokenCount ?? originalTokenCount
            : originalTokenCount;
          break;
        }
        case 'reactive': {
          result = await this.reactiveService.compactReactively(
            sessionId,
            sessionMessages,
            model
          );
          compressedTokenCount = result?.result?.postCompactTokenCount ?? originalTokenCount;
          break;
        }
        case 'micro': {
          const { microcompactMessages } = await import('./microCompact');
          const microResult = microcompactMessages(
            sessionMessages,
            querySource
          );
          result = microResult;
          compressedTokenCount = microResult
            ? roughTokenCountEstimationForMessages(microResult.messages)
            : originalTokenCount;
          break;
        }
      }

      const reductionRatio = originalTokenCount > 0
        ? 1 - compressedTokenCount / originalTokenCount
        : 0;

      const record: CompactRecord = {
        strategy: decision.strategy as 'auto' | 'reactive' | 'micro' | 'none',
        timestamp: new Date(),
        originalTokenCount,
        compressedTokenCount,
        reductionRatio,
        sessionId,
        success: true,
      };

      this.recordCompact(sessionId, record);
      this.circuitBreaker.recordSuccess();
      logger.info(`Compact succeeded [${decision.strategy}]`, {
        sessionId,
        originalTokens: originalTokenCount,
        compressedTokens: compressedTokenCount,
        reduction: `${(reductionRatio * 100).toFixed(1)}%`,
      });

      return { strategy: decision.strategy, success: true, result, record };
    } catch (error) {
      this.circuitBreaker.recordFailure();

      const record: CompactRecord = {
        strategy: decision.strategy as 'auto' | 'reactive' | 'micro' | 'none',
        timestamp: new Date(),
        originalTokenCount,
        compressedTokenCount: originalTokenCount,
        reductionRatio: 0,
        sessionId,
        success: false,
      };

      this.recordCompact(sessionId, record);
      logger.error(`Compact failed [${decision.strategy}]: ${error instanceof Error ? error.message : String(error)}`);

      return { strategy: decision.strategy, success: false, result: null, record };
    }
  }

  getCompactHistory(sessionId: string): CompactRecord[] {
    return this.compactHistory.get(sessionId) ?? [];
  }

  getAllCompactStats(): {
    totalCompacts: number;
    totalTokensSaved: number;
    strategyBreakdown: Record<string, number>;
    successRate: number;
  } {
    let totalCompacts = 0;
    let totalTokensSaved = 0;
    let successCount = 0;
    const strategyBreakdown: Record<string, number> = {};

    for (const records of this.compactHistory.values()) {
      for (const record of records) {
        totalCompacts++;
        totalTokensSaved += record.originalTokenCount - record.compressedTokenCount;
        if (record.success) successCount++;
        strategyBreakdown[record.strategy] = (strategyBreakdown[record.strategy] ?? 0) + 1;
      }
    }

    return {
      totalCompacts,
      totalTokensSaved,
      strategyBreakdown,
      successRate: totalCompacts > 0 ? successCount / totalCompacts : 1,
    };
  }

  private shouldMicrocompact(
    messages: SessionMessage[],
    querySource?: string
  ): boolean {
    const trigger = evaluateTimeBasedTrigger(messages, querySource);
    return trigger !== null;
  }

  private recordCompact(sessionId: string, record: CompactRecord): void {
    const records = this.compactHistory.get(sessionId) ?? [];
    records.push(record);
    this.compactHistory.set(sessionId, records);
  }
}
