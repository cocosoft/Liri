import type { BudgetPeriod, SessionTokenBudgetConfig } from './BudgetTypes';

export interface TokenConsumptionRecord {
  tokens: number;
  timestamp: number;
}

export class BudgetTracker {
  private consumption = new Map<string, TokenConsumptionRecord[]>();
  private periodStart = new Map<string, number>();

  recordConsumption(
    sessionId: string,
    tokens: number,
    period: BudgetPeriod = 'per_session'
  ): void {
    const records = this.consumption.get(sessionId) ?? [];
    records.push({ tokens, timestamp: Date.now() });
    this.consumption.set(sessionId, records);

    if (!this.periodStart.has(sessionId)) {
      this.periodStart.set(sessionId, Date.now());
    }
  }

  getCurrentUsage(
    sessionId: string,
    period: BudgetPeriod = 'per_session'
  ): number {
    const records = this.consumption.get(sessionId);
    if (!records) return 0;

    const start = this.getPeriodStart(sessionId, period);
    const relevant = records.filter((r) => r.timestamp >= start);
    return relevant.reduce((sum, r) => sum + r.tokens, 0);
  }

  getUsagePercentage(
    sessionId: string,
    config: SessionTokenBudgetConfig
  ): number {
    const usage = this.getCurrentUsage(sessionId, config.period);
    return config.maxTokens > 0 ? usage / config.maxTokens : 0;
  }

  getConsumptionHistory(
    sessionId: string,
    limit?: number
  ): TokenConsumptionRecord[] {
    const records = this.consumption.get(sessionId);
    if (!records) return [];
    const sorted = [...records].sort((a, b) => b.timestamp - a.timestamp);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  resetSession(sessionId: string): void {
    this.consumption.delete(sessionId);
    this.periodStart.delete(sessionId);
  }

  clearAll(): void {
    this.consumption.clear();
    this.periodStart.clear();
  }

  private getPeriodStart(sessionId: string, period: BudgetPeriod): number {
    const now = Date.now();
    if (period === 'per_session') {
      return this.periodStart.get(sessionId) ?? now;
    }
    if (period === 'hourly') {
      return now - 60 * 60 * 1000;
    }
    return now - 24 * 60 * 60 * 1000;
  }
}
