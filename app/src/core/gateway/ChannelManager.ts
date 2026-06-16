/**
 * ChannelManager — 统一通道生命周期管理（遗留版）
 * 管理所有 GatewayChannel 的注册、启停、消息路由和健康监控
 *
 * @deprecated 请使用 channels/registry/ChannelRegistry 替代。
 *   core/gateway/ 体系后续将统一收敛到 channels/ 体系。
 *   此模块将在未来版本中移除。
 */

import { EventEmitter } from 'events';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { handleError } from '@modules/error/handleError';
import { getRedactMiddleware } from '../../security/redact/RedactMiddleware';
import type { CoreAPI } from '../../runtime/api/CoreAPI';
import type {
  GatewayChannel,
  ChannelConfig,
  ChannelEventCallbacks,
  InboundMessage,
  OutboundMessage,
} from './types';
import { ChannelType, ChannelStatus, ChannelEvent } from './types';
import { validateInboundFrame } from './protocol/validators';
import type { ValidationResult } from './protocol/validators';
import { HealthMonitor } from './HealthMonitor';
import type { HealthReport } from './HealthMonitor';
import { ChannelStatusReporter } from './ChannelStatusReporter';
import type { StatusReport } from './ChannelStatusReporter';
import { RateLimiter } from './RateLimiter';
import { GatewayAuth } from './auth/GatewayAuth';
import { channelEventBus, ChannelEvents } from '../../channels/events/ChannelEventBus.js';
import { ChannelPluginRegistry } from './ChannelPluginRegistry';
import { isChannelPlugin } from './ChannelPlugin';
import type { ChannelPlugin } from './ChannelPlugin';
import { routeChannelMessage } from '../../channels/routing/messageRouter';
import type { MessageContext } from '../../channels/types/IChannel';
import { channelRegistry } from '../../channels/registry/ChannelRegistry';
import type { ChannelInterface } from '../../channels/registry/ChannelRegistry';
const rawLogger = new Logger({ level: LogLevel.INFO, module: 'channel:manager' });

class RedactedLogger {
  info(msg: string, meta?: Record<string, unknown>) {
    rawLogger.info(getRedactMiddleware().redactMessage(msg), meta);
  }
  warning(msg: string, meta?: Record<string, unknown>) {
    rawLogger.warning(getRedactMiddleware().redactMessage(msg), meta);
  }
  error(msg: string, meta?: Record<string, unknown>) {
    rawLogger.error(msg, meta);
  }
  debug(msg: string, meta?: Record<string, unknown>) {
    rawLogger.debug(getRedactMiddleware().redactMessage(msg), meta);
  }
}

const logger = new RedactedLogger() as unknown as Logger;

/** 废弃告警是否已输出（全局仅输出一次） */
let _channelManagerDeprecationWarned = false;

/** 通道管理器配置 */
export interface ChannelManagerConfig {
  /** 全局自动重连 */
  autoReconnect?: boolean;
  /** 全局重连间隔（毫秒） */
  reconnectInterval?: number;
  /** 健康检查间隔（毫秒），0 表示禁用 */
  healthCheckInterval?: number;
  /** 默认最大重连次数 */
  maxReconnectAttempts?: number;
}

/** 通道注册信息 */
interface ChannelRegistration {
  channel: GatewayChannel;
  config: ChannelConfig;
  reconnectAttempts: number;
  healthCheckTimer?: ReturnType<typeof setInterval>;
}

/**
 * 通道管理器
 * 负责通道注册、生命周期控制、消息路由和健康监控
 */
/**
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
   * 用于外部查询通道插件注册状态
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
          await handleError(err, { module: 'channel:manager', action: 'unregister_old_entry', context: { channelName: channel.name } });
        });
      }
    }

    const registration: ChannelRegistration = {
      channel,
      config: { ...channel.config },
      reconnectAttempts: 0,
    };

    channel.setCallbacks(this.createChannelCallbacks(channel));
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
      channelRegistry.register(this.adaptToChannelInterface(channel));
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

    this.stopChannelInternal(registration).catch(async (err) => {
      await handleError(err, { module: 'channel:manager', action: 'stop_channel', context: { channelName: name } });
    });

    this.channels.delete(name);
    this.healthMonitor.unregisterChannel(name);
    this.statusReporter.unregisterChannel(name);

    // 同步从插件注册表注销
    const registry = ChannelPluginRegistry.getInstance();
    if (registry.has(name)) {
      registry.unregister(name).catch(async (err) => {
        await handleError(err, { module: 'channel:manager', action: 'registry_unregister', context: { channelName: name } });
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
        this.startChannelInternal(reg)
      )
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      logger.warning(`ChannelManager: ${failed} 个通道启动失败`);
    }

    this.statusReporter.start();
    this.healthMonitor.start();

    if (this.config.healthCheckInterval > 0) {
      this.startGlobalHealthCheck();
    }

    this.healthMonitor.on('health:channel_unhealthy', (status) => {
      logger.warning(`ChannelManager: 通道不健康 — ${status.channelName}`, {
        message: status.message,
      });
      const reg = this.channels.get(status.channelName);
      if (reg && this.config.autoReconnect) {
        this.attemptReconnect(status.channelName, reg);
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
        this.stopChannelInternal(reg)
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

    await this.startChannelInternal(registration);
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

    await this.stopChannelInternal(registration);
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
      await handleError(error, { module: 'channel:manager', action: 'send_message', context: { channelName: name } });
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

  /**
   * 创建通道事件回调
   */
  private createChannelCallbacks(
    channel: GatewayChannel
  ): ChannelEventCallbacks {
    return {
      onConnected: () => {
        const reg = this.channels.get(channel.name);
        if (reg) {
          reg.reconnectAttempts = 0;
        }
        this.emit(ChannelEvent.CONNECTED, channel.name);
        channelEventBus.publish(ChannelEvents.CHANNEL_CONNECTED, { channelName: channel.name });
        logger.info(`ChannelManager: 通道已连接 — ${channel.name}`);
      },

      onDisconnected: (reason?: string) => {
        this.emit(ChannelEvent.DISCONNECTED, channel.name, reason);
        channelEventBus.publish(ChannelEvents.CHANNEL_DISCONNECTED, {
          channelName: channel.name,
          reason: reason ?? 'unknown',
        });
        logger.warning(
          `ChannelManager: 通道已断开 — ${channel.name}${reason ? ` (${reason})` : ''}`
        );

        const reg = this.channels.get(channel.name);
        if (reg && this.config.autoReconnect && this.isRunning) {
          this.attemptReconnect(channel.name, reg);
        }
      },

      onError: async (error: Error) => {
        this.emit(ChannelEvent.ERROR, channel.name, error);
        channelEventBus.publish(ChannelEvents.CHANNEL_ERROR, {
          channelName: channel.name,
          error: error.message,
        });
        await handleError(error, { module: 'channel:manager', action: 'channel_error', context: { channelName: channel.name } });
      },

      onMessage: (message: InboundMessage) => {
        this.emit(ChannelEvent.MESSAGE, channel.name, message);
        channelEventBus.publish(ChannelEvents.MESSAGE_RECEIVED, {
          channelName: channel.name,
          messageId: message.id,
          senderId: message.sender,
        });
        this.routeMessage(channel, message);
      },

      onStateChange: (status: ChannelStatus, previous: ChannelStatus) => {
        this.emit(ChannelEvent.STATE_CHANGE, channel.name, status, previous);
        channelEventBus.publish(ChannelEvents.CHANNEL_STATE_CHANGE, {
          channelName: channel.name,
          status,
          previousStatus: previous,
        });
      },

      onReconnecting: (attempt: number, maxAttempts: number) => {
        this.emit(
          ChannelEvent.RECONNECTING,
          channel.name,
          attempt,
          maxAttempts
        );
        channelEventBus.publish(ChannelEvents.CHANNEL_RECONNECTING, {
          channelName: channel.name,
          attempt,
          maxAttempts,
        });
      },
    };
  }

  /**
   * 将 GatewayChannel 适配为 ChannelInterface，用于同步到 ChannelRegistry
   */
  private adaptToChannelInterface(channel: GatewayChannel): ChannelInterface {
    return {
      name: channel.name,
      type: channel.type,
      enabled: true,
      get connected() {
        return channel.isConnected();
      },
      connect: async () => {
        try {
          await channel.connect();
          return true;
        } catch {
          return false;
        }
      },
      disconnect: async () => {
        await channel.disconnect();
      },
      sendMessage: async (_target: string, text: string) => {
        return channel.send({
          content: text,
          sessionId: _target,
          recipient: _target,
        });
      },
      getStatus: () => ({
        status: channel.status,
        connected: channel.isConnected(),
        stats: channel.stats,
      }),
    };
  }

  /**
   * 验证入站消息的合法性
   */
  private validateInboundMessage(message: InboundMessage): ValidationResult {
    if (!message.id || typeof message.id !== 'string') {
      return { valid: false, errors: ['消息 ID 不能为空'] };
    }
    if (!message.sender || typeof message.sender !== 'string') {
      return { valid: false, errors: ['消息发送者不能为空'] };
    }
    if (
      !message.timestamp ||
      typeof message.timestamp !== 'number' ||
      message.timestamp <= 0
    ) {
      return { valid: false, errors: ['消息时间戳无效'] };
    }

    if (
      message.raw &&
      typeof message.raw === 'object' &&
      Object.keys(message.raw).length > 0
    ) {
      const frameResult = validateInboundFrame(message.raw);
      if (!frameResult.valid) {
        return frameResult;
      }
    }

    return { valid: true };
  }

  /**
   * 返回结构化错误帧到通道
   */
  private async sendErrorResponse(
    channel: GatewayChannel,
    message: InboundMessage,
    code: string,
    errorMessage: string
  ): Promise<void> {
    const errorFrame = {
      type: 'error' as const,
      error: {
        code,
        message: errorMessage,
        details: {
          originalMessageId: message.id,
          channel: channel.name,
        },
      },
    };

    try {
      if (channel.isConnected()) {
        await channel.send({
          content: JSON.stringify(errorFrame),
          sessionId: message.sessionId || 'unknown',
          recipient: message.sender,
          type: 'text',
          metadata: { isErrorFrame: true, errorCode: code },
        });
      }
    } catch (sendError) {
      await handleError(sendError, { module: 'channel:manager', action: 'send_error_frame', context: { channelName: channel.name } });
    }

    logger.warning(`ChannelManager: 非法消息被拦截 — ${channel.name}`, {
      messageId: message.id,
      errorCode: code,
      errorMessage,
    });
  }

  /**
   * 路由入站消息到 CoreAPI
   * 在路由前先验证消息合法性
   *
   * @deprecated 内部委托到 routeChannelMessage()，旧路径保留兼容。
   *   新通道应直接调用 channels/routing/messageRouter 的 routeChannelMessage()。
   */
  private async routeMessage(
    channel: GatewayChannel,
    message: InboundMessage
  ): Promise<void> {
    // 将旧 InboundMessage 转换为新 MessageContext 格式
    const messageContext: MessageContext = {
      messageId: message.id,
      channelId: channel.name as MessageContext['channelId'],
      senderId: message.sender,
      content: message.content,
      messageType: 'text',
      timestamp: message.timestamp,
      isDirectMessage: true,
      conversationId: message.sessionId || message.sender,
      rawPayload: message.raw || {},
    };

    // 委托到统一路由入口
    const result = await routeChannelMessage(messageContext, {
      coreAPI: {
        chat: async (params) => {
          if (!this.coreAPI) {
            throw new Error('CoreAPI 未设置');
          }
          return this.coreAPI.chat({
            content: params.content,
            sessionId: params.sessionId,
            metadata: {
              ...params.metadata,
              channel: channel.name,
            },
          });
        },
      },
      onOutbound: async (content: string, target: string) => {
        await channel.send({
          content,
          sessionId: message.sessionId || 'unknown',
          recipient: target,
          type: 'text',
        });
      },
      channelName: channel.name,
      enableTracing: true,
    });

    // 处理验证失败：保持旧行为的 sendErrorResponse + emit
    if (!result.valid) {
      await this.sendErrorResponse(
        channel,
        message,
        result.errorCode || 'INVALID_FRAME',
        result.errorMessage || '消息格式无效'
      );
      this.emit(
        ChannelEvent.ERROR,
        channel.name,
        new Error(`消息验证失败: ${result.errorMessage}`)
      );
      channelEventBus.publish(ChannelEvents.CHANNEL_ERROR, {
        channelName: channel.name,
        error: `消息验证失败: ${result.errorMessage}`,
        errorCode: result.errorCode || 'INVALID_FRAME',
      });
    }
  }

  /**
   * 启动单通道
   */
  private async startChannelInternal(
    registration: ChannelRegistration
  ): Promise<void> {
    const { channel } = registration;

    try {
      await channel.initialize();
      await channel.connect();
      logger.info(`ChannelManager: 通道已启动 — ${channel.name}`);
    } catch (error) {
      await handleError(error, { module: 'channel:manager', action: 'start_channel', context: { channelName: channel.name } });

      if (this.config.autoReconnect) {
        this.attemptReconnect(channel.name, registration);
      }

      throw error;
    }
  }

  /**
   * 停止单通道
   */
  private async stopChannelInternal(
    registration: ChannelRegistration
  ): Promise<void> {
    const { channel } = registration;

    if (registration.healthCheckTimer) {
      clearInterval(registration.healthCheckTimer);
      registration.healthCheckTimer = undefined;
    }

    try {
      await channel.disconnect();
      logger.info(`ChannelManager: 通道已停止 — ${channel.name}`);
    } catch (error) {
      await handleError(error, { module: 'channel:manager', action: 'stop_channel', context: { channelName: channel.name } });
    }
  }

  /**
   * 尝试重连通道
   */
  private attemptReconnect(
    name: string,
    registration: ChannelRegistration
  ): void {
    if (registration.reconnectAttempts >= this.config.maxReconnectAttempts) {
      logger.warning(
        `ChannelManager: 通道 ${name} 已达最大重连次数 (${this.config.maxReconnectAttempts})`
      );
      return;
    }

    registration.reconnectAttempts++;

    const callbacks = this.createChannelCallbacks(registration.channel);
    callbacks.onReconnecting?.(
      registration.reconnectAttempts,
      this.config.maxReconnectAttempts
    );

    setTimeout(async () => {
      if (!this.isRunning) {
        return;
      }

      logger.info(
        `ChannelManager: 重连通道 ${name} (${registration.reconnectAttempts}/${this.config.maxReconnectAttempts})`
      );

      try {
        await registration.channel.disconnect();
        await registration.channel.initialize();
        await registration.channel.connect();
        registration.reconnectAttempts = 0;
        logger.info(`ChannelManager: 通道 ${name} 重连成功`);
      } catch (error) {
        await handleError(error, { module: 'channel:manager', action: 'reconnect_channel', context: { channelName: name } });
        this.attemptReconnect(name, registration);
      }
    }, this.config.reconnectInterval);
  }

  /**
   * 启动全局健康检查
   */
  private startGlobalHealthCheck(): void {
    this.globalHealthTimer = setInterval(async () => {
      await this.healthCheck();
    }, this.config.healthCheckInterval);

    this.globalHealthTimer.unref();
  }
}

/** 通道管理器状态概览 */
export interface ChannelManagerStatus {
  isRunning: boolean;
  totalChannels: number;
  connectedChannels: number;
  channels: Array<{
    name: string;
    type: ChannelType;
    status: ChannelStatus;
    connected: boolean;
    stats: Record<string, unknown>;
  }>;
}

let _channelManagerInstance: ChannelManager | null = null;

/**
 * 创建 ChannelManager 实例
 */
export function createChannelManager(
  config?: ChannelManagerConfig
): ChannelManager {
  return new ChannelManager(config);
}

/**
 * 获取全局 ChannelManager 单例
 * 首次调用时自动创建
 */
export function getChannelManager(
  config?: ChannelManagerConfig
): ChannelManager {
  if (!_channelManagerInstance) {
    _channelManagerInstance = createChannelManager(config);
  }
  return _channelManagerInstance;
}

/**
 * 断开所有通道连接（用于优雅关闭）
 * 安全可重入
 */
export async function disconnectAllChannels(): Promise<void> {
  if (!_channelManagerInstance) {
    return;
  }
  await _channelManagerInstance.stop();
}
