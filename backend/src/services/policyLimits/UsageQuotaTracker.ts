import type { UsageQuota } from './types'
import { LimitType } from './types'
import { PolicyLimitsClient } from './PolicyLimitsClient'

export class UsageQuotaTracker {
  private dailyCounters: Map<LimitType, number> = new Map()
  private sessionCounters: Map<LimitType, number> = new Map()
  private resetDate: string = this.getToday()
  private sessionId: string

  constructor(sessionId?: string) {
    this.sessionId = sessionId || `session_${Date.now()}`
    this.reset()
  }

  private getToday(): string {
    return new Date().toISOString().split('T')[0]
  }

  private reset(): void {
    const today = this.getToday()
    if (today === this.resetDate) return

    this.dailyCounters.clear()
    this.sessionCounters.clear()
    this.resetDate = today
  }

  increment(type: LimitType, amount: number = 1): number {
    this.reset()
    const current = (this.dailyCounters.get(type) || 0) + amount
    this.dailyCounters.set(type, current)

    const session = (this.sessionCounters.get(type) || 0) + amount
    this.sessionCounters.set(type, session)

    return current
  }

  getDailyUsage(type: LimitType): number {
    this.reset()
    return this.dailyCounters.get(type) || 0
  }

  getSessionUsage(type: LimitType): number {
    return this.sessionCounters.get(type) || 0
  }

  getAllDailyUsage(): ReadonlyMap<LimitType, number> {
    this.reset()
    return this.dailyCounters
  }

  getAllSessionUsage(): ReadonlyMap<LimitType, number> {
    return this.sessionCounters
  }

  getQuota(client: PolicyLimitsClient, type: LimitType): UsageQuota {
    this.reset()
    return {
      type,
      current: this.dailyCounters.get(type) || 0,
      limit: client.getLimit(type),
      resetAt: new Date(this.resetDate + 'T00:00:00Z').getTime() + 86400000,
      unit: this.getUnitForType(type),
    }
  }

  getAllQuotas(client: PolicyLimitsClient): UsageQuota[] {
    return [
      this.getQuota(client, LimitType.DAILY_MESSAGES),
      this.getQuota(client, LimitType.DAILY_TOKENS),
      this.getQuota(client, LimitType.DAILY_TOOLS),
    ]
  }

  private getUnitForType(type: LimitType): 'count' | 'tokens' | 'bytes' | 'sessions' {
    switch (type) {
      case LimitType.DAILY_TOKENS:
      case LimitType.HOURLY_TOKENS:
        return 'tokens'
      case LimitType.MAX_FILE_SIZE:
        return 'bytes'
      case LimitType.MAX_CONCURRENT_SESSIONS:
        return 'sessions'
      default:
        return 'count'
    }
  }

  getSessionId(): string {
    return this.sessionId
  }
}
