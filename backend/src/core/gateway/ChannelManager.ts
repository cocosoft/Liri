/**
 * ChannelManager — 统一通道生命周期管理
 * 管理所有 GatewayChannel 的注册、启停、消息路由和健康监控
 */

import { EventEmitter } from 'events';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import type { CoreAPI } from '../api/CoreAPI';
import type {
  GatewayChannel,
  ChannelConfig,
  ChannelEventCallbacks,
  InboundMessage,
  OutboundMessage,
} from './types';
import { ChannelType, ChannelStatus, ChannelEvent } from './types';

const logger = new Logger({ level: LogLevel.INFO });

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
export class ChannelManager extends EventEmitter {
  private channels: Map<string, ChannelRegistration> = new Map();
  private coreAPI: CoreAPI | null = null;
  private config: Required<ChannelManagerConfig>;
  private globalHealthTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(config?: ChannelManagerConfig) {
    super();

    this.config = {
      autoReconnect: config?.autoReconnect ?? true,
      reconnectInterval: config?.reconnectInterval ?? 5000,
      healthCheckInterval: config?.healthCheckInterval ?? 30000,
      maxReconnectAttempts: config?.maxReconnectAttempts ?? 5,
    };
  }

  /**
   * 设置 CoreAPI 实例，用于消息路由
   */
  setCoreAPI(api: CoreAPI): void {
    this.coreAPI = api;
    logger.info('ChannelManager: CoreAPI 已设置');
  }

  /**
   * 注册通道
   */
  registerChannel(channel: GatewayChannel): void {
    if (this.channels.has(channel.name)) {
      logger.warning(`ChannelManager: 通道 ${channel.name} 已存在，将被覆盖`);
    }

    const registration: ChannelRegistration = {
      channel,
      config: { ...channel.config },
      reconnectAttempts: 0,
    };

    channel.setCallbacks(this.createChannelCallbacks(channel));
    this.channels.set(channel.name, registration);

    logger.info(`ChannelManager: 通道已注册 — ${channel.name} (${channel.type})`);
    this.emit(ChannelEvent.STATE_CHANGE, channel.name, channel.status);
  }

  /**
   * 注销通道
   */
  unregisterChannel(name: string): void {
    const registration = this.channels.get(name);
    if (!registration) {
      logger.warning(`ChannelManager: 通道 ${name} 不存在`);
      return;
    }

    this.stopChannelInternal(registration).catch((err) => {
      logger.error(`ChannelManager: 停止通道 ${name} 失败`, { error: String(err) });
    });

    this.channels.delete(name);
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
      Array.from(this.channels.values()).map((reg) => this.startChannelInternal(reg)),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      logger.warning(`ChannelManager: ${failed} 个通道启动失败`);
    }

    if (this.config.healthCheckInterval > 0) {
      this.startGlobalHealthCheck();
    }

    logger.info(`ChannelManager: 启动完成，${this.channels.size - failed}/${this.channels.size} 通道就绪`);
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

    const results = await Promise.allSettled(
      Array.from(this.channels.values()).map((reg) => this.stopChannelInternal(reg)),
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
      throw new AppError(`通道 ${name} 未注册`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1005');
    }

    await this.startChannelInternal(registration);
  }

  /**
   * 停止指定通道
   */
  async stopChannel(name: string): Promise<void> {
    const registration = this.channels.get(name);
    if (!registration) {
      throw new AppError(`通道 ${name} 未注册`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1005');
    }

    await this.stopChannelInternal(registration);
  }

  /**
   * 通过通道发送消息
   */
  async sendToChannel(name: string, message: OutboundMessage): Promise<boolean> {
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
      logger.error(`ChannelManager: 发送消息至 ${name} 失败`, { error: String(error) });
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
      }),
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
   * 执行全通道健康检查
   */
  async healthCheck(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    await Promise.all(
      Array.from(this.channels.entries()).map(async ([name, reg]) => {
        try {
          const healthy = await reg.channel.healthCheck();
          results.set(name, healthy);

          if (!healthy && this.config.autoReconnect) {
            this.attemptReconnect(name, reg);
          }
        } catch {
          results.set(name, false);
          if (this.config.autoReconnect) {
            this.attemptReconnect(name, reg);
          }
        }
      }),
    );

    return results;
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
      }),
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
  private createChannelCallbacks(channel: GatewayChannel): ChannelEventCallbacks {
    return {
      onConnected: () => {
        const reg = this.channels.get(channel.name);
        if (reg) {
          reg.reconnectAttempts = 0;
        }
        this.emit(ChannelEvent.CONNECTED, channel.name);
        logger.info(`ChannelManager: 通道已连接 — ${channel.name}`);
      },

      onDisconnected: (reason?: string) => {
        this.emit(ChannelEvent.DISCONNECTED, channel.name, reason);
        logger.warning(`ChannelManager: 通道已断开 — ${channel.name}${reason ? ` (${reason})` : ''}`);

        const reg = this.channels.get(channel.name);
        if (reg && this.config.autoReconnect && this.isRunning) {
          this.attemptReconnect(channel.name, reg);
        }
      },

      onError: (error: Error) => {
        this.emit(ChannelEvent.ERROR, channel.name, error);
        logger.error(`ChannelManager: 通道错误 — ${channel.name}`, { error: error.message });
      },

      onMessage: (message: InboundMessage) => {
        this.emit(ChannelEvent.MESSAGE, channel.name, message);
        this.routeMessage(channel, message);
      },

      onStateChange: (status: ChannelStatus, previous: ChannelStatus) => {
        this.emit(ChannelEvent.STATE_CHANGE, channel.name, status, previous);
      },

      onReconnecting: (attempt: number, maxAttempts: number) => {
        this.emit(ChannelEvent.RECONNECTING, channel.name, attempt, maxAttempts);
      },
    };
  }

  /**
   * 路由入站消息到 CoreAPI
   */
  private async routeMessage(channel: GatewayChannel, message: InboundMessage): Promise<void> {
    if (!this.coreAPI) {
      logger.warning('ChannelManager: CoreAPI 未设置，消息无法路由');
      return;
    }

    try {
      const response = await this.coreAPI.chat({
        content: message.content,
        sessionId: message.sessionId,
        metadata: {
          ...message.raw,
          channel: channel.name,
          sender: message.sender,
        },
      });

      if (response.content) {
        await channel.send({
          content: response.content,
          sessionId: response.sessionId,
          recipient: message.sender,
        });
      }
    } catch (error) {
      logger.error(`ChannelManager: 消息路由失败 — ${channel.name}`, {
        error: String(error),
        messageId: message.id,
      });
    }
  }

  /**
   * 启动单通道
   */
  private async startChannelInternal(registration: ChannelRegistration): Promise<void> {
    const { channel } = registration;

    try {
      await channel.initialize();
      await channel.connect();
      logger.info(`ChannelManager: 通道已启动 — ${channel.name}`);
    } catch (error) {
      logger.error(`ChannelManager: 通道 ${channel.name} 启动失败`, { error: String(error) });

      if (this.config.autoReconnect) {
        this.attemptReconnect(channel.name, registration);
      }

      throw error;
    }
  }

  /**
   * 停止单通道
   */
  private async stopChannelInternal(registration: ChannelRegistration): Promise<void> {
    const { channel } = registration;

    if (registration.healthCheckTimer) {
      clearInterval(registration.healthCheckTimer);
      registration.healthCheckTimer = undefined;
    }

    try {
      await channel.disconnect();
      logger.info(`ChannelManager: 通道已停止 — ${channel.name}`);
    } catch (error) {
      logger.error(`ChannelManager: 通道 ${channel.name} 停止失败`, { error: String(error) });
    }
  }

  /**
   * 尝试重连通道
   */
  private attemptReconnect(name: string, registration: ChannelRegistration): void {
    if (registration.reconnectAttempts >= this.config.maxReconnectAttempts) {
      logger.warning(`ChannelManager: 通道 ${name} 已达最大重连次数 (${this.config.maxReconnectAttempts})`);
      return;
    }

    registration.reconnectAttempts++;

    const callbacks = this.createChannelCallbacks(registration.channel);
    callbacks.onReconnecting?.(registration.reconnectAttempts, this.config.maxReconnectAttempts);

    setTimeout(async () => {
      if (!this.isRunning) {
        return;
      }

      logger.info(`ChannelManager: 重连通道 ${name} (${registration.reconnectAttempts}/${this.config.maxReconnectAttempts})`);

      try {
        await registration.channel.disconnect();
        await registration.channel.initialize();
        await registration.channel.connect();
        registration.reconnectAttempts = 0;
        logger.info(`ChannelManager: 通道 ${name} 重连成功`);
      } catch (error) {
        logger.error(`ChannelManager: 通道 ${name} 重连失败`, { error: String(error) });
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
export function createChannelManager(config?: ChannelManagerConfig): ChannelManager {
  return new ChannelManager(config);
}

/**
 * 获取全局 ChannelManager 单例
 * 首次调用时自动创建
 */
export function getChannelManager(config?: ChannelManagerConfig): ChannelManager {
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
