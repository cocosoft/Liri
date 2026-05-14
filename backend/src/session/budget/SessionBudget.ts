/**
 * SessionBudget 会话磁盘预算管理
 * 对标 OpenClaw 的磁盘预算管理
 */

/**
 * 预算配置
 */
export interface BudgetConfig {
  maxBytes: number;
  warnThreshold: number;
  hardLimit: boolean;
}

/**
 * 预算状态
 */
export interface BudgetStatus {
  used: number;
  limit: number;
  available: number;
  percentage: number;
  isWarning: boolean;
  isExceeded: boolean;
}

/**
 * 预算记录
 */
export interface BudgetRecord {
  sessionId: string;
  bytes: number;
  timestamp: number;
  action: 'write' | 'delete' | 'cleanup';
}

/**
 * 会话预算管理器
 */
export class SessionBudget {
  private usage: Map<string, number> = new Map();
  private records: BudgetRecord[] = [];
  private config: BudgetConfig;
  private maxRecords: number = 10000;

  constructor(config?: Partial<BudgetConfig>) {
    this.config = {
      maxBytes: config?.maxBytes || 100 * 1024 * 1024,
      warnThreshold: config?.warnThreshold || 0.8,
      hardLimit: config?.hardLimit !== false,
    };
  }

  /**
   * 记录写入
   */
  recordWrite(sessionId: string, bytes: number): BudgetStatus {
    const current = this.usage.get(sessionId) || 0;
    this.usage.set(sessionId, current + bytes);

    this.addRecord(sessionId, bytes, 'write');

    return this.getStatus(sessionId);
  }

  /**
   * 记录删除
   */
  recordDelete(sessionId: string, bytes: number): void {
    const current = this.usage.get(sessionId) || 0;
    this.usage.set(sessionId, Math.max(0, current - bytes));

    this.addRecord(sessionId, bytes, 'delete');
  }

  /**
   * 检查是否允许写入
   */
  canWrite(sessionId: string, bytes: number): boolean {
    if (!this.config.hardLimit) return true;

    const current = this.usage.get(sessionId) || 0;

    return current + bytes <= this.config.maxBytes;
  }

  /**
   * 获取预算状态
   */
  getStatus(sessionId?: string): BudgetStatus {
    const used = sessionId
      ? this.usage.get(sessionId) || 0
      : this.getTotalUsage();
    const limit = this.config.maxBytes;
    const percentage = used / limit;

    return {
      used,
      limit,
      available: Math.max(0, limit - used),
      percentage,
      isWarning: percentage >= this.config.warnThreshold,
      isExceeded: percentage >= 1,
    };
  }

  /**
   * 获取会话使用量
   */
  getUsage(sessionId: string): number {
    return this.usage.get(sessionId) || 0;
  }

  /**
   * 获取会话使用记录
   */
  getRecords(sessionId: string, limit?: number): BudgetRecord[] {
    const filtered = this.records
      .filter((r) => r.sessionId === sessionId)
      .reverse();

    return limit ? filtered.slice(0, limit) : filtered;
  }

  /**
   * 重置会话预算
   */
  reset(sessionId: string): void {
    this.usage.delete(sessionId);
  }

  /**
   * 重置所有
   */
  resetAll(): void {
    this.usage.clear();
  }

  /**
   * 获取总使用量
   */
  private getTotalUsage(): number {
    return Array.from(this.usage.values()).reduce((sum, v) => sum + v, 0);
  }

  /**
   * 添加记录
   */
  private addRecord(
    sessionId: string,
    bytes: number,
    action: BudgetRecord['action']
  ): void {
    this.records.push({ sessionId, bytes, timestamp: Date.now(), action });

    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }
}

export const sessionBudget = new SessionBudget();
