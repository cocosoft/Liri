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
 * 事件桥接层
 *
 * 连接通道事件总线（Layer 2）与系统事件总线（Layer 1）。
 * 仅桥接需要全局感知的跨域事件，避免高频通道事件污染系统总线。
 *
 * 桥接规则：
 * - CHANNEL_ERROR（严重连接错误） → globalEventBus:SystemEvents.APP_ERROR
 * - CHANNEL_LIMIT_WARNING（通道配额告警） → globalEventBus:SystemEvents.CONFIG_CHANGE
 * - 其他事件（消息收发、状态变更等）仅在 ChannelEventBus 内闭环
 *
 * 同时通过 handleError 的内存追踪记录，将标准化错误 publish 到 globalEventBus。
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { channelEventBus, ChannelEvents } from './ChannelEventBus';
import type { EventBus } from '../../core/events/EventBus';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'channels:events:bridge',
});

/** 桥接状态 */
let bridgesInitialized = false;

/** 已注册的桥接取消函数 */
const bridgeCleanups: Array<() => void> = [];

/**
 * 初始化通道事件桥接
 *
 * 在应用启动时调用一次。将通道域事件中选择性转发到系统事件总线。
 *
 * @param globalEventBus 系统事件总线实例（Layer 1）
 * @param systemEvents 系统事件常量对象（可选，用于动态导入避免循环依赖）
 */
export function setupEventBridges(
  globalEventBus: EventBus,
  systemEvents?: Record<string, string>
): void {
  if (bridgesInitialized) {
    logger.warning('事件桥接已初始化，跳过重复调用');
    return;
  }
  bridgesInitialized = true;

  // 桥接规则 1：通道严重错误 → 全局 APP_ERROR
  const sub1 = channelEventBus.subscribe(
    ChannelEvents.CHANNEL_ERROR,
    (data: unknown) => {
      const d = data as Record<string, unknown> | undefined;
      const eventName = systemEvents?.APP_ERROR || 'app:error';
      globalEventBus.publish(eventName, {
        message: d?.message || '通道错误',
        code: d?.code || 'CHANNEL_ERROR',
        source: 'channel',
        channelName: d?.channelName,
        timestamp: Date.now(),
      });
    }
  );
  bridgeCleanups.push(() => sub1.unsubscribe());

  // 桥接规则 2：通道配额告警 → 全局 CONFIG_CHANGE
  const sub2 = channelEventBus.subscribe(
    ChannelEvents.CHANNEL_LIMIT_WARNING,
    (data: unknown) => {
      const d = data as Record<string, unknown> | undefined;
      const eventName = systemEvents?.CONFIG_CHANGE || 'config:change';
      globalEventBus.publish(eventName, {
        key: 'channel_limit',
        message: d?.message || '通道配额告警',
        timestamp: Date.now(),
      });
    }
  );
  bridgeCleanups.push(() => sub2.unsubscribe());

  // 桥接规则 3：路由错误 → 全局 APP_ERROR（低严重度）
  const sub3 = channelEventBus.subscribe(
    ChannelEvents.ROUTING_ERROR,
    (data: any) => {
      const eventName = systemEvents?.APP_ERROR || 'app:error';
      globalEventBus.publish(eventName, {
        message: data?.message || '路由错误',
        code: data?.code || 'ROUTING_ERROR',
        source: 'channel',
        severity: 'low',
        timestamp: Date.now(),
      });
    }
  );
  bridgeCleanups.push(() => sub3.unsubscribe());

  // 桥接规则 4（向上）：通道消息入站 → 全局任务创建
  // 每条通道消息在系统事件总线上触发 task:created，供监控/统计订阅
  const sub4 = channelEventBus.subscribe(
    ChannelEvents.MESSAGE_RECEIVED,
    (data: unknown) => {
      const d = data as Record<string, unknown> | undefined;
      const eventName = systemEvents?.TASK_CREATED || 'task:created';
      globalEventBus.publish(eventName, {
        channelName: d?.channelName,
        messageId: d?.messageId,
        senderId: d?.senderId,
        source: 'channel',
        timestamp: Date.now(),
      });
    }
  );
  bridgeCleanups.push(() => sub4.unsubscribe());

  // 桥接规则 5（向下）：系统配置变更 → 通道配置重载
  const sub5 = globalEventBus.subscribe(
    systemEvents?.CONFIG_CHANGED || 'config:changed',
    (data: unknown) => {
      const d = data as Record<string, unknown> | undefined;
      channelEventBus.publish(ChannelEvents.CHANNEL_CONFIG_RELOAD, {
        key: d?.key,
        message: d?.message,
        source: 'system',
        timestamp: Date.now(),
      });
    }
  );
  bridgeCleanups.push(() => sub5.unsubscribe());

  // 桥接规则 6（向下）：系统关闭 → 通道关闭
  const sub6 = globalEventBus.subscribe(
    systemEvents?.APP_SHUTDOWN || 'app:shutdown',
    (data: any) => {
      channelEventBus.publish(ChannelEvents.CHANNEL_SHUTDOWN, {
        reason: data?.reason || 'system_shutdown',
        timestamp: Date.now(),
      });
    }
  );
  bridgeCleanups.push(() => sub6.unsubscribe());

  // 桥接规则 7（向下）：系统初始化完成 → 通道就绪
  const sub7 = globalEventBus.subscribe(
    systemEvents?.APP_INITIALIZED || 'app:initialized',
    (data: unknown) => {
      channelEventBus.publish(ChannelEvents.CHANNEL_SYSTEM_READY, {
        timestamp: Date.now(),
        ...(data as Record<string, unknown>),
      });
    }
  );
  bridgeCleanups.push(() => sub7.unsubscribe());

  logger.info('事件桥接已初始化（7 条规则）');
}

/**
 * 销毁所有桥接
 */
export function destroyEventBridges(): void {
  for (const cleanup of bridgeCleanups) {
    try {
      cleanup();
    } catch (error) {
      // @ignore-catch: 单个监听器清理失败不应阻止其他清理
      logger.warning('桥接清理失败', { error: String(error) });
    }
  }
  bridgeCleanups.length = 0;
  bridgesInitialized = false;
  logger.info('事件桥接已销毁');
}
