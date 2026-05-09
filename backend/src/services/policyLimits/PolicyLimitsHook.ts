import { LimitEnforcer } from './LimitEnforcer';
import { PolicyLimitsClient } from './PolicyLimitsClient';
import { UsageQuotaTracker } from './UsageQuotaTracker';
import type { LimitCheckResult } from './types';
import { LimitType } from './types';

export { LimitEnforcer };
export type { LimitCheckResult };

export interface PolicyLimitsHookResult {
  checkBeforeQuery(totals: {
    messages: number;
    tokens: number;
    tools: number;
  }): {
    allowed: boolean;
    blockedReasons: string[];
    warnings: string[];
  };
  recordAfterQuery(usage: {
    tokens: number;
    messages: number;
    tools: number;
  }): void;
  checkBeforeToolCall(toolName: string): boolean;
  getQuotaStatus(): string;
}

export function createPolicyLimitsHook(
  client?: PolicyLimitsClient,
  tracker?: UsageQuotaTracker
): PolicyLimitsHookResult {
  const limitsClient = client || new PolicyLimitsClient();
  const quotaTracker = tracker || new UsageQuotaTracker();
  const enforcer = new LimitEnforcer(limitsClient, quotaTracker);

  return {
    checkBeforeQuery(totals: {
      messages: number;
      tokens: number;
      tools: number;
    }): {
      allowed: boolean;
      blockedReasons: string[];
      warnings: string[];
    } {
      const results = enforcer.getAllChecks(totals);
      const blockedReasons: string[] = [];
      const warnings: string[] = [];

      for (const result of results) {
        if (!result.allowed) {
          blockedReasons.push(
            result.message || `${result.type} limit exceeded`
          );
        } else if (result.remaining / result.limit < 0.2) {
          warnings.push(
            `Getting close to ${result.type} limit: ${result.remaining}/${result.limit} remaining`
          );
        }
      }

      return {
        allowed: blockedReasons.length === 0,
        blockedReasons,
        warnings,
      };
    },

    recordAfterQuery(usage: {
      tokens: number;
      messages: number;
      tools: number;
    }): void {
      quotaTracker.increment(LimitType.DAILY_TOKENS, usage.tokens);
      quotaTracker.increment(LimitType.DAILY_MESSAGES, usage.messages);
      quotaTracker.increment(LimitType.DAILY_TOOLS, usage.tools);
    },

    checkBeforeToolCall(toolName: string): boolean {
      if (limitsClient.isToolBlocked(toolName)) return false;
      const check = enforcer.checkToolLimit(
        quotaTracker.getDailyUsage(LimitType.DAILY_TOOLS)
      );
      return check.allowed;
    },

    getQuotaStatus(): string {
      const quotas = quotaTracker.getAllQuotas(limitsClient);
      return quotas
        .map(
          (q) =>
            `${q.type}: ${q.current}/${q.limit} (resets ${new Date(q.resetAt).toLocaleString()})`
        )
        .join('\n');
    },
  };
}
