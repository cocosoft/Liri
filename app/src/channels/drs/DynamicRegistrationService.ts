/**
 * DynamicRegistrationService (DRS) 动态注册服务
 * 通道插件的自动发现、动态注册与生命周期管理
 *
 * 提供能力：
 * - 运行时动态注册/注销通道插件
 * - 基于配置源的自动发现
 * - 生命周期感知（注册 → 验证 → 连接 → 健康检查）
 * - 事件通知（注册/注销/状态变更）
 */

import { EventEmitter } from 'node:events';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { channelRegistry } from '../registry/ChannelRegistry';
import type { IChannelPlugin } from '../types/IChannel';

const logger = new Logger({ level: LogLevel.INFO });

/** 通道注册来源类型 */
export type RegistrationSource = 'config' | 'api' | 'plugin' | 'manual';

/** 通道注册信息 */
export interface ChannelRegistration {
  /** 通道标识 */
  id: string;
  /** 显示名称 */
  displayName: string;
  /** 厂商 */
  vendor: string;
  /** 注册来源 */
  source: RegistrationSource;
  /** 注册时间 */
  registeredAt: number;
  /** 最后健康检查时间 */
  lastHealthCheckAt: number;
  /** 连接状态 */
  connected: boolean;
  /** 错误信息 */
  error?: string;
}

/** 通道候选定义（用于动态发现） */
export interface ChannelCandidate {
  /** 通道类型 */
  type: string;
  /** 模块导入路径 */
  importPath: string;
  /** 导出键名 */
  exportKey: string;
  /** 启用条件（环境变量名列表，全部存在时启用） */
  requiredEnvVars: string[];
}

/** 动态注册服务事件 */
export interface DnsEvents {
  'channel:registered': { id: string; source: RegistrationSource };
  'channel:unregistered': { id: string };
  'channel:connected': { id: string };
  'channel:disconnected': { id: string };
  'channel:error': { id: string; error: string };
  'channels:refreshed': { count: number };
}

/**
 * DynamicRegistrationService — 动态注册服务
 *
 * 管理通道插件的运行时注册、发现和生命周期。
 * 支持通过配置源、API 调用和手动方式注册通道。
 *
 * @example
 * ```typescript
 * const drs = new DynamicRegistrationService();
 *
 * // 添加候选通道
 * drs.addCandidate({
 *   type: 'slack',
 *   importPath: '../channels/slack/index',
 *   exportKey: 'slackChannelPlugin',
 *   requiredEnvVars: ['SLACK_BOT_TOKEN'],
 * });
 *
 * // 发现并注册已启用的通道
 * await drs.discoverAndRegister();
 *
 * // 监听事件
 * drs.on('channel:registered', ({ id }) => console.log(`通道已注册: ${id}`));
 * ```
 */
export class DynamicRegistrationService extends EventEmitter {
  /** 通道候选列表 */
  private candidates: ChannelCandidate[] = [];
  /** 已注册通道信息 */
  private registrations: Map<string, ChannelRegistration> = new Map();
  /** 通道插件实例 */
  private pluginInstances: Map<string, IChannelPlugin> = new Map();
  /** 健康检查定时器 */
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  /** 是否已初始化 */
  private initialized = false;

  constructor() {
    super();
  }

  /**
   * 添加通道候选
   */
  addCandidate(candidate: ChannelCandidate): void {
    const existing = this.candidates.findIndex(
      (c) => c.type === candidate.type
    );

    if (existing >= 0) {
      this.candidates[existing] = candidate;
    } else {
      this.candidates.push(candidate);
    }
  }

  /**
   * 移除通道候选
   */
  removeCandidate(type: string): boolean {
    const idx = this.candidates.findIndex((c) => c.type === type);

    if (idx >= 0) {
      this.candidates.splice(idx, 1);
      return true;
    }

    return false;
  }

  /**
   * 获取所有候选通道
   */
  getCandidates(): ChannelCandidate[] {
    return [...this.candidates];
  }

  /**
   * 获取满足启用条件的候选通道
   */
  getEnabledCandidates(): ChannelCandidate[] {
    return this.candidates.filter((c) =>
      c.requiredEnvVars.every((env) => !!process.env[env])
    );
  }

  /**
   * 发现并注册所有已启用通道
   * 扫描候选列表，检查环境变量，动态导入并注册
   */
  async discoverAndRegister(): Promise<{
    registered: number;
    skipped: number;
    errors: string[];
  }> {
    const result = { registered: 0, skipped: 0, errors: [] as string[] };
    const enabled = this.getEnabledCandidates();

    for (const candidate of enabled) {
      const existing = this.registrations.get(candidate.type);
      if (existing) {
        result.skipped++;
        continue;
      }

      try {
        const plugin = await this.loadPlugin(candidate);
        if (!plugin) {
          result.errors.push(`${candidate.type}: 模块加载失败`);
          continue;
        }

        this.registerPlugin(plugin, 'config');
        result.registered++;
      } catch (error) {
        const msg = `${candidate.type}: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(msg);
        logger.error('DRS 通道注册失败', { type: candidate.type, error: msg });
      }
    }

    if (result.registered > 0 || result.errors.length > 0) {
      this.emit('channels:refreshed', { count: result.registered });
    }

    return result;
  }

  /**
   * 动态注册通道插件
   *
   * @param plugin 通道插件实例
   * @param source 注册来源
   */
  registerPlugin(
    plugin: IChannelPlugin,
    source: RegistrationSource = 'manual'
  ): void {
    const existing = this.registrations.get(plugin.id);

    if (existing && existing.connected) {
      logger.warning('DRS: 通道已注册且已连接，跳过重复注册', {
        id: plugin.id,
      });
      return;
    }

    // 注销旧实例（如有）
    if (existing) {
      this.unregister(plugin.id);
    }

    // 注册到注册中心
    channelRegistry.register(plugin);

    // 记录注册信息
    const registration: ChannelRegistration = {
      id: plugin.id,
      displayName: plugin.meta.displayName,
      vendor: plugin.meta.vendor,
      source,
      registeredAt: Date.now(),
      lastHealthCheckAt: 0,
      connected: false,
    };

    this.registrations.set(plugin.id, registration);
    this.pluginInstances.set(plugin.id, plugin);

    logger.info('DRS: 通道已动态注册', {
      id: plugin.id,
      displayName: plugin.meta.displayName,
      source,
    });

    this.emit('channel:registered', { id: plugin.id, source });
  }

  /**
   * 注销通道
   */
  async unregister(id: string): Promise<boolean> {
    const reg = this.registrations.get(id);
    if (!reg) return false;

    // 断开连接
    const plugin = this.pluginInstances.get(id);
    if (plugin) {
      try {
        await plugin.lifecycle.disconnect();
      } catch (error) {
        logger.warning('DRS 断开连接时出错', {
          id,
          error: String(error),
        });
      }
    }

    // 从注册中心移除
    channelRegistry.unregister(id);

    // 清理状态
    this.registrations.delete(id);
    this.pluginInstances.delete(id);

    logger.info('DRS: 通道已注销', { id });
    this.emit('channel:unregistered', { id });

    return true;
  }

  /**
   * 连接指定通道
   */
  async connect(
    id: string,
    config?: Record<string, unknown>
  ): Promise<boolean> {
    const plugin = this.pluginInstances.get(id);
    if (!plugin) return false;

    try {
      await plugin.lifecycle.connect(config ?? {});
      const reg = this.registrations.get(id);
      if (reg) {
        reg.connected = true;
        reg.error = undefined;
      }

      this.emit('channel:connected', { id });

      return true;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const reg = this.registrations.get(id);
      if (reg) {
        reg.connected = false;
        reg.error = errMsg;
      }

      logger.error('DRS: 通道连接失败', { id, error: errMsg });
      this.emit('channel:error', { id, error: errMsg });

      return false;
    }
  }

  /**
   * 断开指定通道
   */
  async disconnect(id: string): Promise<boolean> {
    const plugin = this.pluginInstances.get(id);
    if (!plugin) return false;

    try {
      await plugin.lifecycle.disconnect();
      const reg = this.registrations.get(id);
      if (reg) {
        reg.connected = false;
      }

      this.emit('channel:disconnected', { id });

      return true;
    } catch (error) {
      logger.error('DRS: 通道断开失败', {
        id,
        error: String(error),
      });
      return false;
    }
  }

  /**
   * 连接所有已注册通道
   */
  async connectAll(): Promise<{
    connected: number;
    failed: { id: string; error: string }[];
  }> {
    const result = {
      connected: 0,
      failed: [] as { id: string; error: string }[],
    };

    for (const [id] of this.registrations) {
      const success = await this.connect(id);
      if (success) {
        result.connected++;
      } else {
        const reg = this.registrations.get(id);
        result.failed.push({ id, error: reg?.error ?? '未知错误' });
      }
    }

    return result;
  }

  /**
   * 检查指定通道健康状态
   */
  async healthCheck(id: string): Promise<boolean> {
    const plugin = this.pluginInstances.get(id);
    if (!plugin) return false;

    try {
      const health = await plugin.lifecycle.healthCheck();
      const reg = this.registrations.get(id);
      if (reg) {
        reg.lastHealthCheckAt = Date.now();
        reg.connected = health.healthy;
        if (!health.healthy) {
          reg.error = '健康检查失败';
        } else {
          reg.error = undefined;
        }
      }

      return health.healthy;
    } catch (error) {
      const reg = this.registrations.get(id);
      if (reg) {
        reg.connected = false;
        reg.error = String(error);
      }

      return false;
    }
  }

  /**
   * 获取所有已注册通道信息
   */
  getAllRegistrations(): ChannelRegistration[] {
    return Array.from(this.registrations.values());
  }

  /**
   * 获取指定通道注册信息
   */
  getRegistration(id: string): ChannelRegistration | undefined {
    return this.registrations.get(id);
  }

  /**
   * 获取通道插件实例
   */
  getPlugin(id: string): IChannelPlugin | undefined {
    return this.pluginInstances.get(id);
  }

  /**
   * 获取所有插件实例
   */
  getAllPlugins(): IChannelPlugin[] {
    return Array.from(this.pluginInstances.values());
  }

  /**
   * 启动自动健康检查
   *
   * @param intervalMs 检查间隔（毫秒，默认 60 秒）
   */
  startHealthChecks(intervalMs: number = 60000): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
    }

    this.healthTimer = setInterval(async () => {
      for (const [id] of this.registrations) {
        await this.healthCheck(id);
      }
    }, intervalMs);

    logger.info('DRS: 自动健康检查已启动', { intervalMs });
  }

  /**
   * 停止自动健康检查
   */
  stopHealthChecks(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
      logger.info('DRS: 自动健康检查已停止');
    }
  }

  /**
   * 关闭服务
   */
  async shutdown(): Promise<void> {
    this.stopHealthChecks();

    for (const [id] of this.registrations) {
      await this.unregister(id);
    }

    this.candidates = [];
    this.initialized = false;

    logger.info('DRS: 已关闭');
  }

  /** 动态加载通道插件模块 */
  private async loadPlugin(
    candidate: ChannelCandidate
  ): Promise<IChannelPlugin | undefined> {
    try {
      const mod = await import(candidate.importPath);
      const exportVal = mod[candidate.exportKey];

      if (!exportVal) {
        logger.error('DRS: 模块导出不存在', {
          type: candidate.type,
          exportKey: candidate.exportKey,
          availableKeys: Object.keys(mod),
        });
        return undefined;
      }

      // 支持工厂函数和直接实例
      if (typeof exportVal === 'function') {
        return exportVal();
      }

      return exportVal as IChannelPlugin;
    } catch (error) {
      logger.error('DRS: 模块加载失败', {
        type: candidate.type,
        importPath: candidate.importPath,
        error: String(error),
      });
      return undefined;
    }
  }
}

/** 全局 DRS 实例 */
export const drs = new DynamicRegistrationService();
