import { PolicyLimitsClient } from './PolicyLimitsClient';
import type { LimitCheckResult, PolicyDefinition } from './types';
import { LimitType } from './types';
import { UsageQuotaTracker } from './UsageQuotaTracker';

export enum EnforceResultType {
  ALLOWED = 'allowed',
  BLOCKED = 'blocked',
  WARNING = 'warning',
  THROTTLED = 'throttled',
}

export class LimitEnforcer {
  private client: PolicyLimitsClient;
  private tracker: UsageQuotaTracker;

  constructor(client: PolicyLimitsClient, tracker?: UsageQuotaTracker) {
    this.client = client;
    this.tracker = tracker || new UsageQuotaTracker();
  }

  checkMessageLimit(currentCount: number): LimitCheckResult {
    const limit = this.client.getLimit(LimitType.DAILY_MESSAGES);
    const remaining = limit === Infinity ? Infinity : limit - currentCount;

    if (remaining <= 0) {
      const policy = this.client.getPolicy(LimitType.DAILY_MESSAGES);
      return {
        allowed: false,
        type: LimitType.DAILY_MESSAGES,
        current: currentCount,
        limit,
        remaining: 0,
        message: policy?.message || 'Daily message limit reached',
        blockedBy: policy,
      };
    }

    return {
      allowed: true,
      type: LimitType.DAILY_MESSAGES,
      current: currentCount,
      limit,
      remaining,
    };
  }

  checkTokenLimit(currentTokens: number): LimitCheckResult {
    const limit = this.client.getLimit(LimitType.DAILY_TOKENS);
    const remaining = limit === Infinity ? Infinity : limit - currentTokens;

    if (remaining <= 0) {
      const policy = this.client.getPolicy(LimitType.DAILY_TOKENS);
      return {
        allowed: false,
        type: LimitType.DAILY_TOKENS,
        current: currentTokens,
        limit,
        remaining: 0,
        message: policy?.message || 'Daily token limit reached',
        blockedBy: policy,
      };
    }

    return {
      allowed: true,
      type: LimitType.DAILY_TOKENS,
      current: currentTokens,
      limit,
      remaining,
    };
  }

  checkToolLimit(currentCount: number): LimitCheckResult {
    const limit = this.client.getLimit(LimitType.DAILY_TOOLS);
    const remaining = limit === Infinity ? Infinity : limit - currentCount;

    if (remaining <= 0) {
      const policy = this.client.getPolicy(LimitType.DAILY_TOOLS);
      return {
        allowed: false,
        type: LimitType.DAILY_TOOLS,
        current: currentCount,
        limit,
        remaining: 0,
        message: policy?.message || 'Daily tool call limit reached',
        blockedBy: policy,
      };
    }

    return {
      allowed: true,
      type: LimitType.DAILY_TOOLS,
      current: currentCount,
      limit,
      remaining,
    };
  }

  enforce(type: LimitType, currentValue: number): EnforceResultType {
    const limit = this.client.getLimit(type);
    if (limit === Infinity) return EnforceResultType.ALLOWED;

    const ratio = limit > 0 ? currentValue / limit : 1;

    if (currentValue >= limit) {
      return EnforceResultType.BLOCKED;
    }
    if (ratio >= 0.9) {
      return EnforceResultType.WARNING;
    }
    if (ratio >= 0.75) {
      return EnforceResultType.THROTTLED;
    }
    return EnforceResultType.ALLOWED;
  }

  enforceWithMessage(
    type: LimitType,
    currentValue: number
  ): { result: EnforceResultType; message?: string } {
    const limit = this.client.getLimit(type);
    const policy = this.client.getPolicy(type);
    const ratio = limit > 0 ? currentValue / limit : 0;

    if (currentValue >= limit) {
      return {
        result: EnforceResultType.BLOCKED,
        message:
          policy?.message || `${type} limit reached (${currentValue}/${limit})`,
      };
    }
    if (ratio >= 0.9) {
      return {
        result: EnforceResultType.WARNING,
        message: `Approaching ${type} limit: ${currentValue}/${limit} (${Math.round(ratio * 100)}%)`,
      };
    }
    if (ratio >= 0.75) {
      return {
        result: EnforceResultType.THROTTLED,
        message: `${type} usage high: ${currentValue}/${limit}`,
      };
    }

    return { result: EnforceResultType.ALLOWED };
  }

  getAllChecks(totals: {
    messages: number;
    tokens: number;
    tools: number;
  }): LimitCheckResult[] {
    return [
      this.checkMessageLimit(totals.messages),
      this.checkTokenLimit(totals.tokens),
      this.checkToolLimit(totals.tools),
    ];
  }

  getUsageTracker(): UsageQuotaTracker {
    return this.tracker;
  }
}
