/**
 * [@deprecated — v1.2] 成本跟踪 Passes 钩子
 * 全库无调用方，已由 UsageTracker + COST_RECORDED 事件替代。
 * 计划在后续版本移除。
 * @deprecated Use UsageTracker.trackUsage + COST_RECORDED event subscription instead.
 */
import { PassesService } from './PassesService';
import type { TokenUsage } from './CostAnalyticsTracker';
import { priceManager } from '../core/tokenBudget/PriceManager';

export interface CostCheckResult {
  allowed: boolean;
  currentCostUSD: number;
  budgetUSD: number;
  remainingUSD: number;
  percentUsed: number;
  passType: string;
  message?: string;
}

export class CostTrackerPassesHook {
  private passesService: PassesService;

  constructor(passesService: PassesService) {
    this.passesService = passesService;
  }

  checkCostLimit(currentCostUSD: number): CostCheckResult {
    const balance = this.passesService.getBalance();
    if (!balance) {
      return {
        allowed: true,
        currentCostUSD,
        budgetUSD: Infinity,
        remainingUSD: Infinity,
        percentUsed: 0,
        passType: 'unknown',
      };
    }

    const percentUsed =
      balance.cost.budgetUSD > 0 ? currentCostUSD / balance.cost.budgetUSD : 0;

    if (currentCostUSD >= balance.cost.budgetUSD) {
      return {
        allowed: false,
        currentCostUSD,
        budgetUSD: balance.cost.budgetUSD,
        remainingUSD: 0,
        percentUsed,
        passType: balance.passType,
        message: `Cost limit exceeded: $${currentCostUSD.toFixed(2)} / $${balance.cost.budgetUSD.toFixed(2)}`,
      };
    }

    return {
      allowed: true,
      currentCostUSD,
      budgetUSD: balance.cost.budgetUSD,
      remainingUSD: balance.cost.budgetUSD - currentCostUSD,
      percentUsed,
      passType: balance.passType,
    };
  }

  recordAPICall(modelName: string, usage: TokenUsage): void {
    const priceResult = priceManager.getPriceSync(modelName);
    const { pricing } = priceResult;

    const costUSD =
      (usage.inputTokens / 1_000_000) * pricing.inputPer1M +
      (usage.outputTokens / 1_000_000) * pricing.outputPer1M +
      ((usage.cacheReadInputTokens || 0) / 1_000_000) * pricing.cacheReadPer1M +
      ((usage.cacheCreationInputTokens || 0) / 1_000_000) *
        pricing.cacheWritePer1M;

    this.passesService.recordCost(costUSD);
    this.passesService.recordTokenUsage(usage.totalTokens);
  }

  recordMessage(): void {
    this.passesService.recordMessage();
  }

  recordToolCall(): void {
    this.passesService.recordToolCall();
  }

  passesCostBlocked(): boolean {
    const { over } = this.passesService.isOverQuota();
    return over;
  }

  getPassesSummary(): string {
    return this.passesService.getUsageSummary();
  }

  getCurrentBalance() {
    const daily = this.passesService.getBalance('daily');
    const monthly = this.passesService.getBalance('monthly');
    return { daily, monthly };
  }
}

export function createCostTrackerPassesHook(
  passesService?: PassesService
): CostTrackerPassesHook {
  return new CostTrackerPassesHook(passesService || new PassesService());
}
