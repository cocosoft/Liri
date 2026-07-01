import type { Session } from '../models/Session';
import type {
  PruningStrategy,
  PruningResult,
  PruningContext,
  PruningConfig,
} from './PruningStrategy';
import { DEFAULT_PRUNING_CONFIG } from './PruningStrategy';
import { CacheTTLPruner } from './CacheTTLPruner';
import { SoftTrimmer } from './SoftTrimmer';
import { AgeBasedPruner } from './AgeBasedPruner';
import { CountBasedPruner } from './CountBasedPruner';
import { BudgetBasedPruner } from './BudgetBasedPruner';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

export interface PruningDecision {
  action:
    | 'skip'
    | 'ttl_prune'
    | 'soft_trim'
    | 'age_prune'
    | 'count_prune'
    | 'budget_prune'
    | 'multi';
  results: PruningResult[];
  reason: string;
}

export class PruningDecider {
  private strategies: Map<string, PruningStrategy> = new Map();
  private config: PruningConfig;

  constructor(config?: Partial<PruningConfig>) {
    this.config = { ...DEFAULT_PRUNING_CONFIG, ...config };
    this.registerStrategy(new CacheTTLPruner());
    this.registerStrategy(new SoftTrimmer());
    this.registerStrategy(new AgeBasedPruner());
    this.registerStrategy(new CountBasedPruner());
    this.registerStrategy(new BudgetBasedPruner());
  }

  registerStrategy(strategy: PruningStrategy): void {
    this.strategies.set(strategy.name, strategy);
    logger.debug('Pruning strategy registered', { name: strategy.name });
  }

  updateConfig(partial: Partial<PruningConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getConfig(): PruningConfig {
    return { ...this.config };
  }

  decide(context: PruningContext): PruningDecision {
    if (!this.config.enabled) {
      return { action: 'skip', results: [], reason: 'Pruning disabled' };
    }

    const results: PruningResult[] = [];
    const appliedActions: string[] = [];

    for (const strategy of this.strategies.values()) {
      if (strategy.shouldPrune(context)) {
        const result = strategy.prune(context.session, this.config);
        results.push(result);
        appliedActions.push(strategy.name);
      }
    }

    if (appliedActions.length === 0) {
      return { action: 'skip', results: [], reason: 'No pruning needed' };
    }

    if (appliedActions.length === 1) {
      const actionMap: Record<string, PruningDecision['action']> = {
        CacheTTLPruner: 'ttl_prune',
        SoftTrimmer: 'soft_trim',
        AgeBasedPruner: 'age_prune',
        CountBasedPruner: 'count_prune',
        BudgetBasedPruner: 'budget_prune',
      };
      const action = actionMap[appliedActions[0]] ?? 'multi';
      return {
        action,
        results,
        reason: `${action}: ${results.map((r) => r.reason).join('; ')}`,
      };
    }

    return {
      action: 'multi',
      results,
      reason: `multi: ${results.map((r) => r.reason).join('; ')}`,
    };
  }

  estimateTokenSavings(context: PruningContext): number {
    let savings = 0;

    for (const strategy of this.strategies.values()) {
      if (strategy.shouldPrune(context)) {
        const result = strategy.prune(context.session, this.config);
        savings += result.prunedTokenEstimate;
      }
    }

    return savings;
  }
}
