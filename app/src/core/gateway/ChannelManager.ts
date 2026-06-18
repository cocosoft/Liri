/**
 * ChannelManager — 统一通道生命周期管理（遗留版）
 * 管理所有 GatewayChannel 的注册、启停、消息路由和健康监控
 *
 * @deprecated 请使用 channels/registry/ChannelRegistry 替代。
 *   core/gateway/ 体系后续将统一收敛到 channels/ 体系。
 *   此模块将在未来版本中移除。
 */

import { EventEmitter } from 'events';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { handleError } from '@modules/error/handleError';
import type { CoreAPI } from '../../runtime/api/CoreAPI';
import type {
  GatewayChannel,
  InboundMessage,
  OutboundMessage,
} from './types';
import { ChannelType, ChannelEvent } from './types';
import { HealthMonitor } from './HealthMonitor';
import type { HealthReport } from './HealthMonitor';
import { ChannelStatusReporter } from './ChannelStatusReporter';
import type { StatusReport } from './ChannelStatusReporter';
import { RateLimiter } from './RateLimiter';
import { GatewayAuth } from './auth/GatewayAuth';
import {
  channelEventBus,
  ChannelEvents,
} from '../../channels/events/ChannelEventBus.js';
import { ChannelPluginRegistry } from './ChannelPluginRegistry';
import { isChannelPlugin } from './ChannelPlugin';
import type { ChannelPlugin } from './ChannelPlugin';
import { channelRegistry } from '../../channels/registry/ChannelRegistry';
import type {
  ChannelRegistration,
  ChannelManagerConfig,
  ChannelManagerStatus,
} from './ChannelManagerTypes';
import { logger } from './ChannelManagerTypes'; // RedactedLogger 实例
import {
  adaptToChannelInterface,
  createChannelCallbacks,
  startChannelInternal,
  stopChannelInternal,
  attemptReconnect,
  routeMessage,
  sendErrorResponse,
} from './ChannelManagerInternals';

/** 废弃告警是否已输出（全局仅输出一次） */
let _channelManagerDeprecationWarned = false;

/**
 * 通道管理器
 * 负责通道注册、生命周期控制、消息路由和健康监控
 *
 * @deprecated 请使用 @modules/core/events/EventBus 的 EventBusImpl 替代 Node.js EventEmitter。
 *   此类继承自 Node.js EventEmitter，属于事件孤岛。
 *   新代码应使用 EventBusImpl 替代。
 */
export class ChannelManager extends EventEmitter {
  private channels: Map<string, ChannelRegistration> = new Map();
  private coreAPI: CoreAPI | null = null;
  private config: Required<ChannelManagerConfig>;
  private globalHealthTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private healthMonitor: HealthMonitor;
  private statusReporter: ChannelStatusReporter;
  private rateLimiter: RateLimiter;
  private gatewayAuth: GatewayAuth;

  constructor(config?: ChannelManagerConfig) {
    super();

    // 运行时废弃告警（仅首次实例化输出）
    if (!_channelManagerDeprecationWarned) {
      _channelManagerDeprecationWarned = true;
      logger.warning(
        'ChannelManager 已废弃，请迁移至 channels/registry/ChannelRegistry。' +
          'core/gateway/ 体系将在未来版本中移除。'
      );
    }

    this.config = {
      autoReconnect: config?.autoReconnect ?? true,
      reconnectInterval: config?.reconnectInterval ?? 5000,
      healthCheckInterval: config?.healthCheckInterval ?? 30000,
      maxReconnectAttempts: config?.maxReconnectAttempts ?? 5,
    };

    this.healthMonitor = new HealthMonitor({
      checkIntervalMs:
        this.config.healthCheckInterval > 0
          ? this.config.healthCheckInterval
          : undefined,
    });
    this.statusReporter = new ChannelStatusReporter();
    this.rateLimiter = new RateLimiter({
      windowMs: 60_000,
      maxRequests: 120,
    });
    this.gatewayAuth = new GatewayAuth();
  }

  /**
   * 设置 CoreAPI 实例，用于消息路由
   */
  setCoreAPI(api: CoreAPI): void {
    this.coreAPI = api;
    logger.info('ChannelManager: CoreAPI 已设置');
  }

  getHealthMonitor(): HealthMonitor {
    return this.healthMonitor;
  }

  getStatusReporter(): ChannelStatusReporter {
    return this.statusReporter;
  }

  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  getGatewayAuth(): GatewayAuth {
    return this.gatewayAuth;
  }

  /**
   * 获取 ChannelPluginRegistry 实例
   */
  getPluginRegistry(): ChannelPluginRegistry {
    return ChannelPluginRegistry.getInstance();
  }

  /**
   * 获取已注册的 ChannelPlugin（如果通道同时实现了插件接口）
   */
  getPlugin(id: string): ChannelPlugin | undefined {
    return ChannelPluginRegistry.getInstance().lookup(id);
  }

  /**
   * 注册通道
   * 如果通道同时实现了 ChannelPlugin 接口，自动同步注册到插件注册表
   */
  registerChannel(channel: GatewayChannel): void {
    if (this.channels.has(channel.name)) {
      logger.warning(`ChannelManager: 通道 ${channel.name} 已存在，将被覆盖`);
      // 同步注销旧通道在注册表中的条目
      const registry = ChannelPluginRegistry.getInstance();
      if (registry.has(channel.name)) {
        registry.unregister(channel.name).catch(async (err) => {
          await handleError(err, {
            module: 'channel:manager',
            action: 'unregister_old_entry',
            context: { channelName: channel.name },
          });
        });
      }
    }

    const registration: ChannelRegistration = {
      channel,
      config: { ...channel.config },
      reconnectAttempts: 0,
    };

    // 通过内部工厂创建一个可捕捉 this 闭包的回调包装
    const boundRouteMessage = async (ch: GatewayChannel, msg: InboundMessage): Promise<void> => {
      await routeMessage(ch, msg, this.coreAPI, logger, this.emit.bind(this),
        (c, m, code, err) => sendErrorResponse(c, m, code, err, logger));
    };
    const boundReconnect = (name: string, reg: ChannelRegistration): void => {
      attemptReconnect(name, reg, this.config, () => this.isRunning, logger, this.emit.bind(this));
    };

    channel.setCallbacks(
      createChannelCallbacks(
        channel,
        this.channels,
        this.config,
        () => this.isRunning,
        this.emit.bind(this),
        logger,
        boundRouteMessage,
        boundReconnect
      )
    );

    this.channels.set(channel.name, registration);
    this.healthMonitor.registerChannel(channel);
    this.statusReporter.registerChannel(channel);

    // 如果通道也实现了 ChannelPlugin 接口，同步注册到插件注册表
    if (isChannelPlugin(channel)) {
      const registry = ChannelPluginRegistry.getInstance();
      try {
        registry.register(channel);
        logger.info(
          `ChannelManager: 通道已同步注册到插件注册表 — ${channel.name}`
        );
      } catch (error) {
        logger.warning(
          `ChannelManager: 插件注册表同步失败 — ${channel.name} (${error instanceof Error ? error.message : String(error)})`
        );
      }
    }

    logger.info(
      `ChannelManager: 通道已注册 — ${channel.name} (${channel.type})`
    );
    this.emit(ChannelEvent.STATE_CHANGE, channel.name, channel.status);
    channelEventBus.publish(ChannelEvents.CHANNEL_STATE_CHANGE, {
      channelName: channel.name,
      status: channel.status,
    });

    // 同步到 ChannelRegistry，确保工具和 /channel 命令可访问
    try {
      channelRegistry.register(adaptToChannelInterface(channel));
    } catch (error) {
      logger.warning(
        `ChannelManager: 同步到 ChannelRegistry 失败 — ${channel.name} (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }

  /**
   * 注销通道
   * 同步从插件注册表中注销
   */
  unregisterChannel(name: string): void {
    const registration = this.channels.get(name);
    if (!registration) {
      logger.warning(`ChannelManager: 通道 ${name} 不存在`);
      return;
    }

    stopChannelInternal(registration, logger).catch(async (err) => {
      await handleError(err, {
        module: 'channel:manager',
        action: 'stop_channel',
        context: { channelName: name },
      });
    });

    this.channels.delete(name);
    this.healthMonitor.unregisterChannel(name);
    this.statusReporter.unregisterChannel(name);

    // 同步从插件注册表注销
    const registry = ChannelPluginRegistry.getInstance();
    if (registry.has(name)) {
      registry.unregister(name).catch(async (err) => {
        await handleError(err, {
          module: 'channel:manager',
          action: 'registry_unregister',
          context: { channelName: name },
        });
      });
    }

    logger.info(`ChannelManager: 通道已注销 — ${name}`);
  }

  /**
   * 启动所有已注册通道
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warning('ChannelManager: 已在运行中');
      return;
    }

    this.isRunning = true;
    logger.info('ChannelManager: 启动所有通道...');

    const results = await Promise.allSettled(
      Array.from(this.channels.values()).map((reg) =>
        startChannelInternal(
          reg.channel,
          this.config,
          logger,
          (name: string) => {
            const reg2 = this.channels.get(name);
            if (reg2) {
              attemptReconnect(name, reg2, this.config, () => this.isRunning, logger, this.emit.bind(this));
            }
          }
        )
      )
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      logger.warning(`ChannelManager: ${failed} 个通道启动失败`);
    }

    this.statusReporter.start();
    this.healthMonitor.start();

    if (this.config.healthCheckInterval > 0) {
      this.globalHealthTimer = setInterval(async () => {
        await this.healthCheck();
      }, this.config.healthCheckInterval);
      this.globalHealthTimer.unref();
    }

    this.healthMonitor.on('health:channel_unhealthy', (status) => {
      logger.warning(`ChannelManager: 通道不健康 — ${status.channelName}`, {
        message: status.message,
      });
      const reg = this.channels.get(status.channelName);
      if (reg && this.config.autoReconnect) {
        attemptReconnect(status.channelName, reg, this.config, () => this.isRunning, logger, this.emit.bind(this));
      }
    });

    logger.info(
      `ChannelManager: 启动完成，${this.channels.size - failed}/${this.channels.size} 通道就绪`
    );
  }

  /**
   * 停止所有通道
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    logger.info('ChannelManager: 停止所有通道...');

    if (this.globalHealthTimer) {
      clearInterval(this.globalHealthTimer);
      this.globalHealthTimer = null;
    }

    this.healthMonitor.stop();
    this.statusReporter.stop();

    const results = await Promise.allSettled(
      Array.from(this.channels.values()).map((reg) =>
        stopChannelInternal(reg, logger)
      )
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      logger.warning(`ChannelManager: ${failed} 个通道停止失败`);
    }

    logger.info('ChannelManager: 所有通道已停止');
  }

  /**
   * 启动指定通道
   */
  async startChannel(name: string): Promise<void> {
    const registration = this.channels.get(name);
    if (!registration) {
      throw new AppError(
        `通道 ${name} 未注册`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1005'
      );
    }

    await startChannelInternal(
      registration.channel,
      this.config,
      logger,
      (channelName: string) => {
        const reg = this.channels.get(channelName);
        if (reg) {
          attemptReconnect(channelName, reg, this.config, () => this.isRunning, logger, this.emit.bind(this));
        }
      }
    );
  }

  /**
   * 停止指定通道
   */
  async stopChannel(name: string): Promise<void> {
    const registration = this.channels.get(name);
    if (!registration) {
      throw new AppError(
        `通道 ${name} 未注册`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1005'
      );
    }

    await stopChannelInternal(registration, logger);
  }

  /**
   * 通过通道发送消息
   */
  async sendToChannel(
    name: string,
    message: OutboundMessage
  ): Promise<boolean> {
    const registration = this.channels.get(name);
    if (!registration) {
      logger.warning(`ChannelManager: 发送失败，通道 ${name} 不存在`);
      return false;
    }

    if (!registration.channel.isConnected()) {
      logger.warning(`ChannelManager: 发送失败，通道 ${name} 未连接`);
      return false;
    }

    try {
      const result = await registration.channel.send(message);
      if (result) {
        logger.debug(`ChannelManager: 消息已发送至 ${name}`);
      }
      return result;
    } catch (error) {
      await handleError(error, {
        module: 'channel:manager',
        action: 'send_message',
        context: { channelName: name },
      });
      return false;
    }
  }

  /**
   * 广播消息到所有已连接通道
   */
  async broadcast(message: OutboundMessage): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    await Promise.all(
      Array.from(this.channels.entries()).map(async ([name]) => {
        const success = await this.sendToChannel(name, message);
        results.set(name, success);
      })
    );

    return results;
  }

  /**
   * 获取已注册通道
   */
  getChannel(name: string): GatewayChannel | undefined {
    return this.channels.get(name)?.channel;
  }

  /**
   * 列出所有已注册通道
   */
  listChannels(): GatewayChannel[] {
    return Array.from(this.channels.values()).map((reg) => reg.channel);
  }

  /**
   * 按类型筛选通道
   */
  getChannelsByType(type: ChannelType): GatewayChannel[] {
    return this.listChannels().filter((ch) => ch.type === type);
  }

  /**
   * 执行全通道健康检查（使用 HealthMonitor）
   */
  async healthCheck(): Promise<Map<string, boolean>> {
    const report = await this.healthMonitor.runHealthCheck();
    const results = new Map<string, boolean>();
    for (const status of report.statuses) {
      results.set(status.channelName, status.healthy);
    }
    return results;
  }

  /**
   * 获取 DetailedHealthReport
   */
  async getDetailedHealthReport(): Promise<HealthReport> {
    return this.healthMonitor.runHealthCheck();
  }

  /**
   * 获取通道状态报告
   */
  generateStatusReport(): StatusReport {
    return this.statusReporter.generateReport(this.isRunning);
  }

  /**
   * 获取管理器状态概览
   */
  getStatus(): ChannelManagerStatus {
    const channelStatuses = Array.from(this.channels.entries()).map(
      ([name, reg]) => ({
        name,
        type: reg.channel.type,
        status: reg.channel.status,
        connected: reg.channel.isConnected(),
        stats: { ...reg.channel.stats },
      })
    );

    return {
      isRunning: this.isRunning,
      totalChannels: this.channels.size,
      connectedChannels: channelStatuses.filter((c) => c.connected).length,
      channels: channelStatuses,
    };
  }
}

// 向后兼容：维持原有的导出路径
export { createChannelManager, getChannelManager, disconnectAllChannels } from './ChannelManagerFactory';
export type { ChannelManagerConfig, ChannelManagerStatus } from './ChannelManagerTypes';
