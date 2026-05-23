export type BudgetPeriod = 'per_session' | 'hourly' | 'daily';

export type EnforcementAction = 'allow' | 'warn' | 'downgrade' | 'reject';

export interface SessionTokenBudgetConfig {
  maxTokens: number;
  period: BudgetPeriod;
  warnThreshold: number;
  downgradeThreshold: number;
  rejectThreshold: number;
}

export interface BudgetDecision {
  action: EnforcementAction;
  reason: string;
  currentUsage: number;
  limit: number;
  percentage: number;
}

export const DEFAULT_TOKEN_BUDGET_CONFIG: SessionTokenBudgetConfig = {
  maxTokens: 200000,
  period: 'per_session',
  warnThreshold: 0.7,
  downgradeThreshold: 0.85,
  rejectThreshold: 1.0,
};

export const TIERED_BUDGET_CONFIGS: Record<string, SessionTokenBudgetConfig> = {
  critical: {
    maxTokens: 500000,
    period: 'per_session',
    warnThreshold: 0.7,
    downgradeThreshold: 0.85,
    rejectThreshold: 1.0,
  },
  high: {
    maxTokens: 300000,
    period: 'per_session',
    warnThreshold: 0.7,
    downgradeThreshold: 0.85,
    rejectThreshold: 1.0,
  },
  normal: {
    maxTokens: 200000,
    period: 'per_session',
    warnThreshold: 0.7,
    downgradeThreshold: 0.85,
    rejectThreshold: 1.0,
  },
  low: {
    maxTokens: 100000,
    period: 'per_session',
    warnThreshold: 0.7,
    downgradeThreshold: 0.85,
    rejectThreshold: 1.0,
  },
};
