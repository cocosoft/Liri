/**
 * 拒绝跟踪器
 * 记录拒绝历史，用于分析拒绝模式和建议退出自动模式
 * 参考CC源码 cc_code/backend/utils/permissions/denialTracking.ts 实现
 */

import { logger } from '@modules/utils/log';

/**
 * 拒绝记录
 */
export interface DenialRecord {
  /** 拒绝ID */
  id: string;
  /** 工具名称 */
  toolName: string;
  /** 工具输入 */
  toolInput: Record<string, unknown>;
  /** 拒绝理由 */
  reason: string;
  /** 拒绝时间 */
  timestamp: number;
  /** 会话ID */
  sessionId: string;
  /** 用户是否覆盖 */
  userOverridden: boolean;
}

/**
 * 拒绝统计
 */
export interface DenialStats {
  totalDenials: number;
  toolDenials: Map<string, number>;
  consecutiveDenials: number;
  recentDenials: DenialRecord[];
  averageDenialRate: number;
  suggestion?: string;
}

/**
 * 拒绝跟踪配置
 */
export interface DenialTrackerConfig {
  /** 最大记录数 */
  maxRecords: number;
  /** 连续拒绝阈值 */
  consecutiveThreshold: number;
  /** 建议退出的拒绝次数 */
  exitThreshold: number;
  /** 滑动窗口大小（毫秒） */
  windowSizeMs: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: DenialTrackerConfig = {
  maxRecords: 1000,
  consecutiveThreshold: 3,
  exitThreshold: 5,
  windowSizeMs: 10 * 60 * 1000, // 10分钟
};

/**
 * 拒绝跟踪器
 */
export class DenialTracker {
  private records: DenialRecord[] = [];
  private config: DenialTrackerConfig;
  private consecutiveCount: number = 0;
  private lastDenialTime: number = 0;
  private listeners: Array<(record: DenialRecord) => void> = [];

  constructor(config: Partial<DenialTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 记录拒绝
   */
  recordDenial(params: {
    toolName: string;
    toolInput: Record<string, unknown>;
    reason: string;
    sessionId: string;
    userOverridden?: boolean;
  }): DenialRecord {
    const record: DenialRecord = {
      id: this.generateId(),
      toolName: params.toolName,
      toolInput: params.toolInput,
      reason: params.reason,
      timestamp: Date.now(),
      sessionId: params.sessionId,
      userOverridden: params.userOverridden ?? false,
    };

    this.records.push(record);
    this.consecutiveCount++;
    this.lastDenialTime = Date.now();

    // 限制记录数
    if (this.records.length > this.config.maxRecords) {
      this.records = this.records.slice(-this.config.maxRecords);
    }

    logger.debug(
      `DenialTracker: Recorded denial for ${params.toolName}, consecutive: ${this.consecutiveCount}`
    );

    // 通知监听器
    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch (error) {
        const e = error instanceof Error ? error : new Error(String(error));
        logger.error('DenialTracker: Listener error:', e);
      }
    }

    return record;
  }

  /**
   * 记录允许
   */
  recordAllow(): void {
    this.consecutiveCount = 0;
  }

  /**
   * 获取连续拒绝次数
   */
  getConsecutiveCount(): number {
    // 检查是否超时
    if (Date.now() - this.lastDenialTime > this.config.windowSizeMs) {
      this.consecutiveCount = 0;
    }
    return this.consecutiveCount;
  }

  /**
   * 获取拒绝统计
   */
  getStats(sessionId?: string): DenialStats {
    const now = Date.now();
    const windowStart = now - this.config.windowSizeMs;

    // 过滤窗口内的记录
    const recentRecords = this.records.filter(
      (r) =>
        r.timestamp >= windowStart && (!sessionId || r.sessionId === sessionId)
    );

    // 统计每个工具的拒绝次数
    const toolDenials = new Map<string, number>();
    for (const record of recentRecords) {
      const count = toolDenials.get(record.toolName) || 0;
      toolDenials.set(record.toolName, count + 1);
    }

    // 计算平均拒绝率
    const totalOps = this.records.length;
    const denialOps = recentRecords.length;
    const averageDenialRate = totalOps > 0 ? denialOps / totalOps : 0;

    // 生成建议
    let suggestion: string | undefined;
    if (this.consecutiveCount >= this.config.exitThreshold) {
      suggestion = '连续拒绝次数过多，建议退出自动模式';
    } else if (this.consecutiveCount >= this.config.consecutiveThreshold) {
      suggestion = '连续拒绝次数较多，请注意操作安全';
    }

    return {
      totalDenials: this.records.length,
      toolDenials,
      consecutiveDenials: this.getConsecutiveCount(),
      recentDenials: recentRecords.slice(-10),
      averageDenialRate,
      suggestion,
    };
  }

  /**
   * 获取特定工具的拒绝记录
   */
  getToolDenials(toolName: string, sessionId?: string): DenialRecord[] {
    return this.records.filter(
      (r) =>
        r.toolName === toolName && (!sessionId || r.sessionId === sessionId)
    );
  }

  /**
   * 获取会话的拒绝记录
   */
  getSessionDenials(sessionId: string): DenialRecord[] {
    return this.records.filter((r) => r.sessionId === sessionId);
  }

  /**
   * 获取最近的拒绝记录
   */
  getRecentDenials(count: number = 10, sessionId?: string): DenialRecord[] {
    const filtered = sessionId
      ? this.records.filter((r) => r.sessionId === sessionId)
      : this.records;

    return filtered.slice(-count);
  }

  /**
   * 检查是否应该建议退出
   */
  shouldSuggestExit(): boolean {
    return this.consecutiveCount >= this.config.consecutiveThreshold;
  }

  /**
   * 检查是否应该强制退出
   */
  shouldForceExit(): boolean {
    return this.consecutiveCount >= this.config.exitThreshold;
  }

  /**
   * 添加监听器
   */
  addListener(listener: (record: DenialRecord) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 移除监听器
   */
  removeListener(listener: (record: DenialRecord) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 清除所有记录
   */
  clear(): void {
    this.records = [];
    this.consecutiveCount = 0;
    this.lastDenialTime = 0;
    logger.info('DenialTracker: All records cleared');
  }

  /**
   * 清除会话记录
   */
  clearSession(sessionId: string): void {
    this.records = this.records.filter((r) => r.sessionId !== sessionId);
    if (this.consecutiveCount > 0) {
      // 重新计算连续计数
      const recent = this.getRecentDenials(1);
      this.consecutiveCount =
        recent.length > 0 && recent[0].sessionId === sessionId ? 1 : 0;
    }
  }

  /**
   * 获取配置
   */
  getConfig(): DenialTrackerConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<DenialTrackerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `denial_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 获取危险工具列表
   */
  getDangerousTools(sessionId?: string): string[] {
    const stats = this.getStats(sessionId);
    const dangerous: string[] = [];

    const entries = Array.from(stats.toolDenials.entries());
    for (const [tool, count] of entries) {
      if (count >= 2) {
        dangerous.push(tool);
      }
    }

    return dangerous;
  }

  /**
   * 获取被覆盖的拒绝记录
   */
  getOverriddenDenials(sessionId?: string): DenialRecord[] {
    const filtered = sessionId
      ? this.records.filter((r) => r.sessionId === sessionId)
      : this.records;

    return filtered.filter((r) => r.userOverridden);
  }

  /**
   * 跟踪拒绝（兼容方法）
   */
  trackDenial(toolName: string): void {
    this.recordDenial({
      toolName,
      toolInput: {},
      reason: 'Denied by permission manager',
      sessionId: 'default',
    });
  }

  /**
   * 跟踪成功（兼容方法）
   */
  trackSuccess(_toolName: string): void {
    this.recordAllow();
  }

  /**
   * 检查是否应该询问用户（兼容方法）
   */
  shouldAsk(_toolName: string): boolean {
    return this.getConsecutiveCount() >= this.config.consecutiveThreshold;
  }

  /**
   * 重置跟踪器（兼容方法）
   */
  reset(): void {
    this.clear();
  }
}

/**
 * 导出单例
 */
export const denialTracker = new DenialTracker();
