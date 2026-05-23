/**
 * PlatformAdapter — 多平台路由抽象层
 *
 * 定义平台适配器接口，支持多消息平台接入：
 * - 统一消息收发
 * - 平台特定认证/鉴权
 * - 会话路由到对应平台
 *
 * 参考 Hermes-Agent gateway/platforms/base.py 的设计：
 * - ABC 定义平台适配器接口
 * - 每个平台实现自己的 send/receive/connect/disconnect
 * - 平台特有的消息格式转换
 */

import type { UnifiedMessage } from '../types/Message';
import type { UnifiedSession } from '../types/Session';

export type PlatformType =
  | 'console'
  | 'webhook'
  | 'websocket'
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'custom';

export interface PlatformConfig {
  platform: PlatformType;
  name: string;
  credentials?: Record<string, string>;
  settings?: Record<string, unknown>;
}

export interface PlatformMessage {
  platform: PlatformType;
  sessionId: string;
  message: UnifiedMessage;
  raw?: unknown;
  receivedAt: number;
}

export interface PlatformSendResult {
  success: boolean;
  platformMessageId?: string;
  error?: string;
  sentAt: number;
}

export interface PlatformConnectionStatus {
  connected: boolean;
  platform: PlatformType;
  name: string;
  connectedAt?: number;
  lastError?: string;
  retryCount: number;
}

export interface PlatformAdapter {
  readonly platformName: string;
  readonly platformType: PlatformType;

  connect(config: PlatformConfig): Promise<void>;
  disconnect(): Promise<void>;

  sendMessage(
    sessionId: string,
    message: UnifiedMessage
  ): Promise<PlatformSendResult>;
  sendBatch(
    sessionId: string,
    messages: UnifiedMessage[]
  ): Promise<PlatformSendResult[]>;

  getConnectionStatus(): PlatformConnectionStatus;
  isConnected(): boolean;
}
