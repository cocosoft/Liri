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
 * 通道事件总线（Layer 2）
 *
 * 独立的通道域事件总线，与系统事件总线（Layer 1, globalEventBus）分离。
 * 通道模块内部高频事件（消息收发、连接状态、会话跟踪等）在此总线内闭环，
 * 避免污染系统事件总线。
 *
 * 跨域事件（如 APP_ERROR 需要全局感知）通过 setupEventBridges.ts 桥接层
 * 选择性转发到 globalEventBus。
 */

import { EventBusImpl, type EventBus, type EventListener, type EventSubscription } from '../../core/events/EventBus';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO, module: 'channels:events' });

/** 通道域事件总线单例 */
export const channelEventBus: EventBus = new EventBusImpl((message: string) => {
  logger.debug(message);
});

/**
 * 通道事件类型枚举
 * 统一管理通道域所有事件名称，避免散布字符串字面量
 */
export const ChannelEvents = {
  // 连接生命周期
  CHANNEL_CONNECTED: 'channel:connected',
  CHANNEL_DISCONNECTED: 'channel:disconnected',
  CHANNEL_RECONNECTING: 'channel:reconnecting',
  CHANNEL_ERROR: 'channel:error',
  CHANNEL_STATE_CHANGE: 'channel:state:change',
  CHANNEL_STOPPED: 'channel:stopped',

  // 消息路由
  MESSAGE_RECEIVED: 'channel:message:received',
  MESSAGE_SENT: 'channel:message:sent',
  MESSAGE_FAILED: 'channel:message:failed',
  MESSAGE_DEDUP: 'channel:message:dedup',

  // 会话管理
  SESSION_CREATED: 'channel:session:created',
  SESSION_UPDATED: 'channel:session:updated',
  SESSION_CLOSED: 'channel:session:closed',
  SESSION_TIMEOUT: 'channel:session:timeout',
  SESSION_ERROR: 'channel:session:error',

  // 系统状态
  CHANNEL_LIMIT_WARNING: 'channel:limit:warning',
  ROUTING_ERROR: 'channel:routing:error',
  REPORT_GENERATED: 'channel:report:generated',
  CHANNEL_CONFIG_RELOAD: 'channel:config:reload',
  CHANNEL_SHUTDOWN: 'channel:shutdown',
  CHANNEL_SYSTEM_READY: 'channel:system:ready',

  // 注册管理
  CHANNEL_REGISTERED: 'channel:registered',
  CHANNEL_UNREGISTERED: 'channel:unregistered',
} as const;

export type ChannelEventType = (typeof ChannelEvents)[keyof typeof ChannelEvents];

// 重新导出常用类型以便消费方使用
export type { EventBus, EventListener, EventSubscription };