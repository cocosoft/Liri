/**
 * 超限额度授予服务
 *
 * 管理 API 调用超出限制时的信用额度授予逻辑。
 * 参考：cc_code/backend/services/api/overageCreditGrant.ts
 */

export interface OverageCreditGrant {
  /** 授予的额度（Token 数或美元） */
  amount: number
  /** 授予时间 */
  grantedAt: Date
  /** 有效期（毫秒），undefined 表示永不过期 */
  expiresAt?: Date
  /** 授予原因 */
  reason: string
  /** 消耗的额度 */
  consumed?: number
}

export interface OverageCreditLimit {
  /** 最大授予次数 */
  maxGrants: number
  /** 单次最大额度 */
  maxAmountPerGrant: number
  /** 周期内最大额度（毫秒） */
  maxAmountPerPeriod: number
  /** 周期长度 */
  periodMs: number
}

export const DEFAULT_CREDIT_LIMIT: OverageCreditLimit = {
  maxGrants: 3,
  maxAmountPerGrant: 100000, // 100K tokens
  maxAmountPerPeriod: 300000, // 300K tokens
  periodMs: 24 * 60 * 60 * 1000, // 24 hours
}

export class OverageCreditGrantService {
  private grants: OverageCreditGrant[] = []
  private limit: OverageCreditLimit

  constructor(limit?: Partial<OverageCreditLimit>) {
    this.limit = { ...DEFAULT_CREDIT_LIMIT, ...limit }
  }

  requestGrant(amount: number, reason: string): OverageCreditGrant | null {
    const now = new Date()

    // 检查授予次数限制
    const recentGrants = this.grants.filter(
      (g) => g.grantedAt.getTime() > now.getTime() - this.limit.periodMs,
    )

    if (recentGrants.length >= this.limit.maxGrants) {
      return null
    }

    // 检查单次额度限制
    const cappedAmount = Math.min(amount, this.limit.maxAmountPerGrant)

    // 检查周期内总额度限制
    const periodTotal = recentGrants.reduce(
      (sum, g) => sum + g.amount,
      0,
    )
    if (periodTotal + cappedAmount > this.limit.maxAmountPerPeriod) {
      return null
    }

    const grant: OverageCreditGrant = {
      amount: cappedAmount,
      grantedAt: now,
      reason,
      consumed: 0,
    }

    this.grants.push(grant)
    return grant
  }

  consumeCredit(grantIndex: number, amount: number): boolean {
    const grant = this.grants[grantIndex]
    if (!grant) return false

    const consumed = (grant.consumed || 0) + amount
    if (consumed > grant.amount) return false

    grant.consumed = consumed
    return true
  }

  getRemainingCredits(): number {
    return this.grants.reduce(
      (sum, g) => sum + (g.amount - (g.consumed || 0)),
      0,
    )
  }

  getGrantHistory(): OverageCreditGrant[] {
    return [...this.grants].reverse()
  }

  clearExpired(): void {
    const now = new Date()
    this.grants = this.grants.filter(
      (g) => !g.expiresAt || g.expiresAt > now,
    )
  }

  reset(): void {
    this.grants = []
  }
}
