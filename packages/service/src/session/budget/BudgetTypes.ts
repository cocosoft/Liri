export type BudgetPeriod = 'per_session' | 'hourly' | 'daily';

/**
 * 会话预算执行动作。
 *
 * 2026-10-06（U5 / 台账 N-80 裁定「删除死面」）：原含 `'downgrade'` —— 但该值
 * ① **生产中不可达**（`SessionManager.setSessionBudget` **0 调用方** ⇒ `budgetConfigs` 恒空
 *    ⇒ `BudgetEnforcer.evaluate()` 恒返回 `'allow'`）；
 * ② **无任何消费者**（`BudgetDecision.action` 只被 `canProceed` 读作 `!== 'reject'`）；
 * ③ 其原意「预算吃紧 ⇒ 自动换模型」与「模型选择不得擅自变更用户所选」（`model-usage.md`）**冲突**
 * ⇒ 收敛移除，连同伴生的 `downgradeThreshold`。
 */
export type EnforcementAction = 'allow' | 'warn' | 'reject';

export interface SessionTokenBudgetConfig {
  maxTokens: number;
  period: BudgetPeriod;
  warnThreshold: number;
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
  rejectThreshold: 1.0,
};

export const TIERED_BUDGET_CONFIGS: Record<string, SessionTokenBudgetConfig> = {
  critical: {
    maxTokens: 500000,
    period: 'per_session',
    warnThreshold: 0.7,
    rejectThreshold: 1.0,
  },
  high: {
    maxTokens: 300000,
    period: 'per_session',
    warnThreshold: 0.7,
    rejectThreshold: 1.0,
  },
  normal: {
    maxTokens: 200000,
    period: 'per_session',
    warnThreshold: 0.7,
    rejectThreshold: 1.0,
  },
  low: {
    maxTokens: 100000,
    period: 'per_session',
    warnThreshold: 0.7,
    rejectThreshold: 1.0,
  },
};
