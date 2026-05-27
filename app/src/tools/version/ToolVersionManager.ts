/**
 * 工具注册表版本管理 + 灰度发布策略
 * 为工具注册表增加版本号和灰度发布能力
 */
import { EventEmitter } from 'node:events';

/**
 * 工具版本信息
 */
export interface ToolVersionInfo {
  toolName: string;
  currentVersion: string;
  previousVersions: string[];
  registeredAt: number;
  updatedAt: number;
  enabled: boolean;
}

/**
 * 灰度发布策略
 */
export type CanaryStrategy =
  | 'all_users'
  | 'percentage'
  | 'whitelist'
  | 'channel_specific'
  | 'role_specific';

/**
 * 灰度发布配置
 */
export interface CanaryConfig {
  strategy: CanaryStrategy;
  percentage: number;
  whitelistUsers: string[];
  whitelistChannels: string[];
  whitelistRoles: string[];
  gradualRollout: boolean;
  rolloutDurationMs: number;
}

/**
 * 工具灰度条目
 */
export interface ToolCanaryEntry {
  toolName: string;
  version: string;
  canaryConfig: CanaryConfig;
  stableVersion: string;
  canaryVersion: string;
  startedAt: number;
  completedAt: number | null;
  status: 'active' | 'completed' | 'rolled_back';
  metrics: {
    errorRate: number;
    avgLatencyMs: number;
    requestCount: number;
  };
}

/**
 * 默认灰度配置
 */
export const DEFAULT_CANARY_CONFIG: CanaryConfig = {
  strategy: 'percentage',
  percentage: 10,
  whitelistUsers: [],
  whitelistChannels: [],
  whitelistRoles: [],
  gradualRollout: true,
  rolloutDurationMs: 3600_000,
};

/**
 * 工具注册表版本管理器
 */
export class ToolVersionManager extends EventEmitter {
  private versions: Map<string, ToolVersionInfo> = new Map();
  private canaryEntries: Map<string, ToolCanaryEntry> = new Map();

  /**
   * 注册工具
   * @param toolName 工具名
   * @param version 版本号
   */
  registerTool(toolName: string, version: string): void {
    const now = Date.now();
    const existing = this.versions.get(toolName);

    if (existing) {
      existing.previousVersions.push(existing.currentVersion);
      existing.currentVersion = version;
      existing.updatedAt = now;
    } else {
      this.versions.set(toolName, {
        toolName,
        currentVersion: version,
        previousVersions: [],
        registeredAt: now,
        updatedAt: now,
        enabled: true,
      });
    }
  }

  /**
   * 获取工具版本信息
   * @param toolName 工具名
   */
  getVersion(toolName: string): ToolVersionInfo | undefined {
    return this.versions.get(toolName);
  }

  /**
   * 获取所有已注册工具的版本
   */
  getAllVersions(): ToolVersionInfo[] {
    return Array.from(this.versions.values());
  }

  /**
   * 启动灰度发布
   * @param toolName 工具名
   * @param canaryVersion 灰度版本
   * @param config 灰度配置
   */
  startCanary(
    toolName: string,
    canaryVersion: string,
    config?: Partial<CanaryConfig>
  ): void {
    const versionInfo = this.versions.get(toolName);
    if (!versionInfo) return;

    const entry: ToolCanaryEntry = {
      toolName,
      version: canaryVersion,
      canaryConfig: { ...DEFAULT_CANARY_CONFIG, ...config },
      stableVersion: versionInfo.currentVersion,
      canaryVersion,
      startedAt: Date.now(),
      completedAt: null,
      status: 'active',
      metrics: { errorRate: 0, avgLatencyMs: 0, requestCount: 0 },
    };

    this.canaryEntries.set(toolName, entry);

    this.emit('canaryStarted', {
      toolName,
      canaryVersion,
      stableVersion: versionInfo.currentVersion,
    });

    if (entry.canaryConfig.gradualRollout) {
      this.scheduleGradualRollout(toolName);
    }
  }

  /**
   * 完成灰度发布（推广到全量）
   * @param toolName 工具名
   */
  completeCanary(toolName: string): void {
    const entry = this.canaryEntries.get(toolName);
    if (!entry || entry.status !== 'active') return;

    entry.status = 'completed';
    entry.completedAt = Date.now();

    const versionInfo = this.versions.get(toolName);
    if (versionInfo) {
      versionInfo.previousVersions.push(versionInfo.currentVersion);
      versionInfo.currentVersion = entry.canaryVersion;
      versionInfo.updatedAt = Date.now();
    }

    this.emit('canaryCompleted', { toolName, version: entry.canaryVersion });
  }

  /**
   * 回滚灰度
   * @param toolName 工具名
   */
  rollbackCanary(toolName: string): void {
    const entry = this.canaryEntries.get(toolName);
    if (!entry || entry.status !== 'active') return;

    entry.status = 'rolled_back';
    entry.completedAt = Date.now();

    this.emit('canaryRolledBack', {
      toolName,
      stableVersion: entry.stableVersion,
    });
  }

  /**
   * 检查用户是否在灰度范围内
   * @param toolName 工具名
   * @param userId 用户 ID
   * @param channelId 渠道 ID
   * @param role 角色
   */
  isInCanaryGroup(
    toolName: string,
    userId?: string,
    channelId?: string,
    role?: string
  ): boolean {
    const entry = this.canaryEntries.get(toolName);
    if (!entry || entry.status !== 'active') return false;

    switch (entry.canaryConfig.strategy) {
      case 'all_users':
        return true;
      case 'whitelist':
        return userId
          ? entry.canaryConfig.whitelistUsers.includes(userId)
          : false;
      case 'channel_specific':
        return channelId
          ? entry.canaryConfig.whitelistChannels.includes(channelId)
          : false;
      case 'role_specific':
        return role ? entry.canaryConfig.whitelistRoles.includes(role) : false;
      case 'percentage': {
        if (entry.canaryConfig.gradualRollout) {
          const elapsed = Date.now() - entry.startedAt;
          const progress = Math.min(
            1,
            elapsed / entry.canaryConfig.rolloutDurationMs
          );
          const currentPercentage = entry.canaryConfig.percentage * progress;

          return this.hashUser(userId || '') % 100 < currentPercentage;
        }

        return (
          this.hashUser(userId || '') % 100 < entry.canaryConfig.percentage
        );
      }
      default:
        return false;
    }
  }

  /**
   * 获取应使用的工具版本
   * @param toolName 工具名
   * @param userId 用户 ID
   * @param channelId 渠道 ID
   * @param role 角色
   */
  resolveVersion(
    toolName: string,
    userId?: string,
    channelId?: string,
    role?: string
  ): string | null {
    const versionInfo = this.versions.get(toolName);
    if (!versionInfo) return null;

    if (this.isInCanaryGroup(toolName, userId, channelId, role)) {
      const entry = this.canaryEntries.get(toolName);

      return entry?.canaryVersion || versionInfo.currentVersion;
    }

    return versionInfo.currentVersion;
  }

  /**
   * 更新灰度指标
   * @param toolName 工具名
   * @param metrics 指标
   */
  updateMetrics(
    toolName: string,
    metrics: Partial<ToolCanaryEntry['metrics']>
  ): void {
    const entry = this.canaryEntries.get(toolName);
    if (!entry) return;

    entry.metrics = { ...entry.metrics, ...metrics };
  }

  /**
   * 获取灰度条目
   * @param toolName 工具名
   */
  getCanaryEntry(toolName: string): ToolCanaryEntry | undefined {
    return this.canaryEntries.get(toolName);
  }

  /**
   * 获取所有灰度条目
   */
  getAllCanaryEntries(): ToolCanaryEntry[] {
    return Array.from(this.canaryEntries.values());
  }

  /**
   * 获取灰度统计
   */
  getCanaryStats(): { active: number; completed: number; rolledBack: number } {
    const all = Array.from(this.canaryEntries.values());

    return {
      active: all.filter((e) => e.status === 'active').length,
      completed: all.filter((e) => e.status === 'completed').length,
      rolledBack: all.filter((e) => e.status === 'rolled_back').length,
    };
  }

  /**
   * 调度渐进式扩量
   */
  private scheduleGradualRollout(toolName: string): void {
    const entry = this.canaryEntries.get(toolName);
    if (!entry) return;

    const steps = 10;
    const stepInterval = entry.canaryConfig.rolloutDurationMs / steps;

    for (let step = 1; step <= steps; step++) {
      setTimeout(() => {
        const newPercentage = Math.min(
          entry.canaryConfig.percentage,
          Math.ceil((entry.canaryConfig.percentage / steps) * step)
        );

        this.emit('canaryRolloutProgress', {
          toolName,
          percentage: newPercentage,
          step,
          totalSteps: steps,
        });
      }, stepInterval * step);
    }
  }

  /**
   * 简单哈希函数（用于百分比灰度）
   */
  private hashUser(userId: string): number {
    let hash = 0;

    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }

    return Math.abs(hash);
  }

  /**
   * 禁用工具
   */
  disableTool(toolName: string): void {
    const versionInfo = this.versions.get(toolName);
    if (versionInfo) {
      versionInfo.enabled = false;
    }
  }

  /**
   * 启用工具
   */
  enableTool(toolName: string): void {
    const versionInfo = this.versions.get(toolName);
    if (versionInfo) {
      versionInfo.enabled = true;
    }
  }
}

/**
 * 全局工具版本管理器
 */
let globalVersionManager: ToolVersionManager | null = null;

/**
 * 获取全局工具版本管理器
 */
export function getToolVersionManager(): ToolVersionManager {
  if (!globalVersionManager) {
    globalVersionManager = new ToolVersionManager();
  }

  return globalVersionManager;
}
