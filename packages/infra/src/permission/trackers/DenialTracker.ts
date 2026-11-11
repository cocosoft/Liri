/**
 * 拒绝跟踪器
 * 记录拒绝历史，用于分析拒绝模式和建议退出自动模式
 * 参考CC源码 cc_code/backend/utils/permissions/denialTracking.ts 实现
 */

import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
// C1（2026-10-09）：拒绝事件 id 熵源改用 crypto
import { randomIdSuffix } from '@openliri/infra/utils/common';
import { metrics } from '@opentelemetry/api';
import type { Counter } from '@opentelemetry/api';
import { permissionMetrics } from '../metrics/PermissionMetricsStore';

const logger = getLogger('permission:trackers:denialTracker');

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
  /**
   * P0-2（2026-11-11）：按 `(sessionId, toolName)` 的连续拒绝计数。
   *
   * 原实现只有一个全局 `consecutiveCount` ⇒ A 工具被拒 3 次会让 B 工具（甚至另一个会话）
   * 的判定被「连续拒绝」逻辑误伤（升 ask / 改变结论）。全局计数仅保留给统计口径。
   */
  private consecutiveByKey = new Map<string, number>();
  /** 同上：每个键的最后拒绝时刻（窗口过期按键计算） */
  private lastDenialByKey = new Map<string, number>();

  /**
   * OTel 拒绝计数器（惰性初始化；Meter 未就绪时 noop 兜底）
   */
  private denialCounter: Counter | null = null;

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
    const key = this.keyOf(params.toolName, params.sessionId);
    this.consecutiveByKey.set(
      key,
      (this.consecutiveByKey.get(key) ?? 0) + 1
    );
    this.lastDenialByKey.set(key, Date.now());

    // 限制记录数
    if (this.records.length > this.config.maxRecords) {
      this.records = this.records.slice(-this.config.maxRecords);
    }

    logger.debug(
      `DenialTracker: Recorded denial for ${params.toolName}, consecutive: ${this.consecutiveCount}`
    );

    // OTel 拒绝指标：每次拒绝 +1（tool 维度）
    this.ensureDenialCounter();
    this.denialCounter?.add(1, { tool: params.toolName });
    permissionMetrics.record('denial', { tool: params.toolName });

    // 通知监听器
    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch (error) {
        void handleError(error, {
          module: 'permission:tracker',
          action: '拒绝跟踪器监听器错误',
        });
      }
    }

    return record;
  }

  /**
   * 确保拒绝计数器已创建
   */
  private ensureDenialCounter(): void {
    if (this.denialCounter) return;
    try {
      this.denialCounter = metrics
        .getMeter('liri-permission')
        .createCounter('Liri.permission.denials', {
          description: '权限拒绝次数（tool 维度）',
        });
    } catch {
      // @ignore-catch: metrics 未初始化时不启用计数
    }
  }

  /**
   * 记录允许
   *
   * 无参 ⇒ 清空全局与该工具的所有键（保持旧「任何成功都清零」语义）；
   * 给定 `toolName`（可带 `sessionId`）⇒ 只清对应键，避免 A 工具的成功清掉 B 的计数。
   */
  recordAllow(toolName?: string, sessionId?: string): void {
    this.consecutiveCount = 0;
    if (!toolName) {
      this.consecutiveByKey.clear();
      this.lastDenialByKey.clear();
      return;
    }
    if (sessionId) {
      this.dropKey(this.keyOf(toolName, sessionId));
      return;
    }
    for (const key of [...this.consecutiveByKey.keys()]) {
      if (key.endsWith(`\u0000${toolName}`)) this.dropKey(key);
    }
  }

  /**
   * 获取连续拒绝次数
   *
   * 无 `toolName` ⇒ 全局计数（统计口径）；给定 `toolName` ⇒ 该 `(session,tool)` 的计数。
   */
  getConsecutiveCount(toolName?: string, sessionId?: string): number {
    if (!toolName) {
      // 检查是否超时
      if (Date.now() - this.lastDenialTime > this.config.windowSizeMs) {
        this.consecutiveCount = 0;
      }
      return this.consecutiveCount;
    }
    const key = this.keyOf(toolName, sessionId);
    const last = this.lastDenialByKey.get(key) ?? 0;
    if (Date.now() - last > this.config.windowSizeMs) {
      this.dropKey(key);
      return 0;
    }
    return this.consecutiveByKey.get(key) ?? 0;
  }

  /** 计数键：`<sessionId>\u0000<toolName>`（session 缺省按 `default`） */
  private keyOf(toolName: string | undefined, sessionId?: string): string {
    return `${sessionId ?? 'default'}\u0000${toolName ?? '*'}`;
  }

  /** 删除某个计数键（计数 + 时刻） */
  private dropKey(key: string): void {
    this.consecutiveByKey.delete(key);
    this.lastDenialByKey.delete(key);
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
    return `denial_${Date.now()}_${randomIdSuffix(9)}`;
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
   *
   * P0-2（2026-11-11）：透传 `sessionId`（缺省 `default`），计数按 `(session,tool)` 隔离。
   */
  trackDenial(toolName: string, sessionId: string = 'default'): void {
    this.recordDenial({
      toolName,
      toolInput: {},
      reason: 'Denied by permission manager',
      sessionId,
    });
  }

  /**
   * 跟踪成功（兼容方法）
   *
   * 只清该 `(session,tool)` 的连续计数（不再清空其它工具/会话）。
   */
  trackSuccess(toolName?: string, sessionId?: string): void {
    this.recordAllow(toolName, sessionId);
  }

  /**
   * 检查是否应该询问用户（兼容方法）
   *
   * P0-2：按 `(session,tool)` 判定（原实现全局计数 ⇒ 跨工具/会话串味）。
   */
  shouldAsk(toolName: string, sessionId: string = 'default'): boolean {
    return (
      this.getConsecutiveCount(toolName, sessionId) >=
      this.config.consecutiveThreshold
    );
  }

  /**
   * 检查是否应升级到用户（方案接口）
   * 连续拒绝次数 >= 3 时返回 true
   * @returns 是否应升级到用户
   */
  shouldEscalateToUser(): boolean {
    return this.getConsecutiveCount() >= this.config.consecutiveThreshold;
  }

  /**
   * 获取指定会话的连续拒绝次数（方案接口）
   * @param sessionId 会话ID
   * @returns 连续拒绝次数
   */
  getConsecutiveDenialCount(sessionId: string): number {
    const sessionRecords: DenialRecord[] = [];
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i].sessionId === sessionId) {
        sessionRecords.push(this.records[i]);
      }
    }

    if (sessionRecords.length === 0) {
      return 0;
    }

    let count = 0;
    for (const record of sessionRecords) {
      if (!record.userOverridden) {
        count++;
      } else {
        break;
      }
    }

    return count;
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
