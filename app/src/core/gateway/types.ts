// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * Gateway 通道类型定义
 * 定义统一的外部通信通道接口和协议
 */

/** 通道类型枚举 */
export enum ChannelType {
  /** Telegram Bot */
  TELEGRAM = 'telegram',
  /** WebSocket */
  WEBSOCKET = 'websocket',
  /** HTTP REST */
  HTTP = 'http',
  /** 命令行 */
  CLI = 'cli',
  /** Slack */
  SLACK = 'slack',
  /** Discord */
  DISCORD = 'discord',
  /** 自定义 */
  CUSTOM = 'custom',
}

/** 通道状态枚举 */
export enum ChannelStatus {
  /** 待机 */
  IDLE = 'idle',
  /** 连接中 */
  CONNECTING = 'connecting',
  /** 已连接 */
  CONNECTED = 'connected',
  /** 已断开 */
  DISCONNECTED = 'disconnected',
  /** 错误 */
  ERROR = 'error',
  /** 已停止 */
  STOPPED = 'stopped',
}

/** 消息方向 */
export enum MessageDirection {
  /** 入站（外部 → 系统） */
  INBOUND = 'inbound',
  /** 出站（系统 → 外部） */
  OUTBOUND = 'outbound',
}

/** 入站消息 */
export interface InboundMessage {
  /** 消息唯一 ID */
  id: string;
  /** 消息内容 */
  content: string;
  /** 会话 ID（如存在） */
  sessionId?: string;
  /** 发送者标识 */
  sender: string;
  /** 原始消息元数据 */
  raw: Record<string, unknown>;
  /** 接收时间戳 */
  timestamp: number;
}

/** 出站消息 */
export interface OutboundMessage {
  /** 消息内容 */
  content: string;
  /** 会话 ID */
  sessionId: string;
  /** 接收者标识 */
  recipient: string;
  /** 消息类型 */
  type?: 'text' | 'markdown' | 'html';
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
}

/** 通道配置基类 */
export interface ChannelConfig {
  /** 通道名称 */
  name: string;
  /** 通道类型 */
  type: ChannelType;
  /** 是否启用 */
  enabled?: boolean;
  /** 自动重连 */
  autoReconnect?: boolean;
  /** 重连间隔（毫秒） */
  reconnectInterval?: number;
  /** 最大重连次数 */
  maxReconnectAttempts?: number;
}

/** 通道生命周期事件 */
export enum ChannelEvent {
  /** 连接成功 */
  CONNECTED = 'connected',
  /** 断开连接 */
  DISCONNECTED = 'disconnected',
  /** 连接错误 */
  ERROR = 'error',
  /** 收到消息 */
  MESSAGE = 'message',
  /** 状态变更 */
  STATE_CHANGE = 'state_change',
  /** 重连中 */
  RECONNECTING = 'reconnecting',
  /** 已停止 */
  STOPPED = 'stopped',
}

/** 通道事件回调 */
export interface ChannelEventCallbacks {
  onConnected?: () => void;
  onDisconnected?: (reason?: string) => void;
  onError?: (error: Error) => void;
  onMessage?: (message: InboundMessage) => void;
  onStateChange?: (status: ChannelStatus, previous: ChannelStatus) => void;
  onReconnecting?: (attempt: number, maxAttempts: number) => void;
}

/** 通道统计 */
export interface ChannelStats {
  /** 已接收消息数 */
  messagesReceived: number;
  /** 已发送消息数 */
  messagesSent: number;
  /** 错误次数 */
  errors: number;
  /** 重连次数 */
  reconnects: number;
  /** 运行时长（毫秒） */
  uptimeMs: number;
  /** 最后活动时间 */
  lastActivityAt: number;
}

/**
 * Gateway 通道接口
 * 所有外部通道适配器必须实现此接口
 */
export interface GatewayChannel {
  /** 通道名称 */
  readonly name: string;
  /** 通道类型 */
  readonly type: ChannelType;
  /** 当前状态 */
  readonly status: ChannelStatus;
  /** 通道配置 */
  readonly config: ChannelConfig;
  /** 通道统计 */
  readonly stats: ChannelStats;

  /** 初始化通道 */
  initialize(): Promise<void>;

  /** 连接通道 */
  connect(): Promise<void>;

  /** 断开通道 */
  disconnect(): Promise<void>;

  /** 发送消息 */
  send(message: OutboundMessage): Promise<boolean>;

  /** 检查连接状态 */
  isConnected(): boolean;

  /** 获取通道健康状态 */
  healthCheck(): Promise<boolean>;

  /** 注册事件回调 */
  setCallbacks(callbacks: ChannelEventCallbacks): void;

  /** 获取通道诊断信息 */
  getDiagnostics(): Record<string, unknown>;
}
