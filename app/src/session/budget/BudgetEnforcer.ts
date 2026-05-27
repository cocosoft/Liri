import type {
  SessionTokenBudgetConfig,
  BudgetDecision,
  EnforcementAction,
} from './BudgetTypes';
import { BudgetTracker } from './BudgetTracker';

export class BudgetEnforcer {
  private budgetConfigs = new Map<string, SessionTokenBudgetConfig>();
  private tracker: BudgetTracker;

  constructor(tracker: BudgetTracker) {
    this.tracker = tracker;
  }

  setBudgetConfig(sessionId: string, config: SessionTokenBudgetConfig): void {
    this.budgetConfigs.set(sessionId, config);
  }

  getBudgetConfig(sessionId: string): SessionTokenBudgetConfig | undefined {
    return this.budgetConfigs.get(sessionId);
  }

  removeBudgetConfig(sessionId: string): void {
    this.budgetConfigs.delete(sessionId);
  }

  evaluate(sessionId: string, estimatedTokens: number = 0): BudgetDecision {
    const config = this.budgetConfigs.get(sessionId);
    if (!config) {
      return {
        action: 'allow',
        reason: 'No budget configured',
        currentUsage: 0,
        limit: 0,
        percentage: 0,
      };
    }

    const currentUsage = this.tracker.getCurrentUsage(sessionId, config.period);
    const projectedUsage = currentUsage + estimatedTokens;
    const percentage = projectedUsage / config.maxTokens;

    let action: EnforcementAction;
    let reason: string;

    if (percentage >= config.rejectThreshold) {
      action = 'reject';
      reason = `Token budget exceeded: ${projectedUsage}/${config.maxTokens} (${Math.round(percentage * 100)}%)`;
    } else if (percentage >= config.downgradeThreshold) {
      action = 'downgrade';
      reason = `Token budget near limit, downgrading: ${projectedUsage}/${config.maxTokens} (${Math.round(percentage * 100)}%)`;
    } else if (percentage >= config.warnThreshold) {
      action = 'warn';
      reason = `Token budget warning: ${projectedUsage}/${config.maxTokens} (${Math.round(percentage * 100)}%)`;
    } else {
      action = 'allow';
      reason = '';
    }

    return {
      action,
      reason,
      currentUsage: projectedUsage,
      limit: config.maxTokens,
      percentage,
    };
  }

  canProceed(sessionId: string, estimatedTokens: number = 0): boolean {
    const decision = this.evaluate(sessionId, estimatedTokens);
    return decision.action !== 'reject';
  }

  clearAll(): void {
    this.budgetConfigs.clear();
  }
}
