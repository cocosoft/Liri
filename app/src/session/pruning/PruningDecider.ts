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
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export interface PruningDecision {
  action: 'skip' | 'ttl_prune' | 'soft_trim' | 'both';
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
    let action: PruningDecision['action'] = 'skip';

    const ttlPruner = this.strategies.get('CacheTTLPruner');
    const softTrimmer = this.strategies.get('SoftTrimmer');

    const ttlNeeded = ttlPruner?.shouldPrune(context) ?? false;
    const trimNeeded = softTrimmer?.shouldPrune(context) ?? false;

    if (ttlNeeded && trimNeeded) {
      action = 'both';
      const ttlResult = ttlPruner!.prune(context.session, this.config);
      results.push(ttlResult);
      const trimResult = softTrimmer!.prune(context.session, this.config);
      results.push(trimResult);
    } else if (ttlNeeded) {
      action = 'ttl_prune';
      const ttlResult = ttlPruner!.prune(context.session, this.config);
      results.push(ttlResult);
    } else if (trimNeeded) {
      action = 'soft_trim';
      const trimResult = softTrimmer!.prune(context.session, this.config);
      results.push(trimResult);
    }

    return {
      action,
      results,
      reason:
        action === 'skip'
          ? 'No pruning needed'
          : `${action}: ${results.map((r) => r.reason).join('; ')}`,
    };
  }

  estimateTokenSavings(context: PruningContext): number {
    let savings = 0;

    const ttlPruner = this.strategies.get('CacheTTLPruner');
    const softTrimmer = this.strategies.get('SoftTrimmer');

    if (ttlPruner?.shouldPrune(context) ?? false) {
      const result = ttlPruner!.prune(context.session, this.config);
      savings += result.prunedTokenEstimate;
    }

    return savings;
  }
}
