/**
 * ChannelManager 类型定义
 * 从 ChannelManager.ts 抽取，遵循单类原则。
 */
import { Logger, LogLevel } from '@modules/monitoring';
import { getRedactMiddleware } from '../../security/redact/RedactMiddleware';
import type { GatewayChannel, ChannelConfig, ChannelStatus } from './types';
import { ChannelType } from './types';

const rawLogger = new Logger({
  level: LogLevel.INFO,
  module: 'channel:manager',
});

/**
 * 带脱敏功能的日志包装器
 */
export class RedactedLogger {
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

/** 全局 RedactedLogger 实例 */
export const logger = new RedactedLogger();

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
export interface ChannelRegistration {
  channel: GatewayChannel;
  config: ChannelConfig;
  reconnectAttempts: number;
  healthCheckTimer?: ReturnType<typeof setInterval>;
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
