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
 * EventBusCompat — 适配层
 *
 * 包装 EventBusImpl，提供兼容 EventEmitter 模式的 API，
 * 实现从遗留 EventEmitter（node:events → events）到 EventBusImpl 的渐进迁移。
 *
 * 用法：
 * ```typescript
 * // 旧代码（EventEmitter 风格）
 * const compat = new EventBusCompat(bus);
 * compat.on('event', handler);      // 映射到 bus.subscribe()
 * compat.emit('event', data);       // 映射到 bus.publish()
 * compat.off('event', handler);     // 映射到 bus.unsubscribe()
 * compat.once('event', handler);    // 映射到 bus.once()
 * ```
 */

import type {
  EventBus,
  EventListener,
  EventSubscription,
} from '../../core/events/EventBus';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  level: LogLevel.DEBUG,
  module: 'channels:events:compat',
});

/*
 * EventBusCompat 类型声明（使用 interface 确保与 EventEmitter 的兼容性）
 */
export interface EventBusCompat {
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
  emit(event: string, ...args: any[]): boolean;
  listenerCount(event: string): number;
  removeAllListeners(event?: string): this;
}

/**
 * 创建 EventBusCompat 实例
 *
 * 将 EventBus 包装为与 EventEmitter 兼容的接口，使旧代码可以
 * 无缝切换到 EventBusImpl 而不需要改动事件订阅语法。
 */
export function createEventBusCompat(bus: EventBus): EventBusCompat {
  const subscriptions = new Map<
    string,
    Map<EventListener, EventSubscription>
  >();

  function ensureSubMap(event: string): Map<EventListener, EventSubscription> {
    if (!subscriptions.has(event)) {
      subscriptions.set(event, new Map());
    }
    return subscriptions.get(event)!;
  }

  const compat: EventBusCompat = {
    on(event: string, listener: (...args: any[]) => void): EventBusCompat {
      const wrapped: EventListener = (data: any) => {
        listener(data);
      };
      const sub = bus.subscribe(event, wrapped);
      ensureSubMap(event).set(listener, sub);
      return compat;
    },

    once(
      event: string,
      listener: (...args: unknown[]) => void
    ): EventBusCompat {
      const wrapped: EventListener = (data: unknown) => {
        listener(data);
      };
      const sub = bus.once(event, wrapped);
      ensureSubMap(event).set(listener, sub);
      return compat;
    },

    off(event: string, listener: (...args: unknown[]) => void): EventBusCompat {
      const subMap = subscriptions.get(event);
      if (subMap) {
        const sub = subMap.get(listener);
        if (sub) {
          sub.unsubscribe();
          subMap.delete(listener);
        }
      }
      return compat;
    },

    emit(event: string, ...args: unknown[]): boolean {
      const data = args.length === 1 ? args[0] : args;
      bus.publish(event, data);
      return bus.hasListeners(event);
    },

    listenerCount(event: string): number {
      return bus.listenerCount(event);
    },

    removeAllListeners(event?: string): EventBusCompat {
      if (event) {
        const subMap = subscriptions.get(event);
        if (subMap) {
          for (const sub of subMap.values()) {
            sub.unsubscribe();
          }
          subMap.clear();
        }
        bus.unsubscribeAll(event);
      } else {
        for (const [, subMap] of subscriptions) {
          for (const sub of subMap.values()) {
            sub.unsubscribe();
          }
        }
        subscriptions.clear();
        bus.unsubscribeAll();
      }
      return compat;
    },
  };

  logger.debug('EventBusCompat 适配器已创建');
  return compat;
}
