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
 * EventBus — 可扩展性事件总线
 *
 * @deprecated 请直接使用 @modules/core/events/EventBus 的标准 EventBus。本封装层通过
 * USE_LEGACY_EXTENSIBILITY 止血开关控制，默认不加载。
 *
 * 基于核心 EventBusImpl 的领域封装，提供可扩展性系统专用的事件机制。
 */

import {
  EventBus as CoreEventBus,
  EventBusImpl,
} from '@modules/core/events/EventBus';
import { EventType, EventData, EventListener } from './types.js';

/**
 * 事件总线（基于核心 EventBus 的封装）
 */
export class EventBus {
  private coreBus: CoreEventBus;

  constructor(bus?: CoreEventBus) {
    this.coreBus = bus || new EventBusImpl();
  }

  /**
   * 注册事件监听器
   */
  on(type: EventType, listener: EventListener): void {
    this.coreBus.subscribe(type, listener);
  }

  /**
   * 移除事件监听器
   */
  off(type: EventType, listener: EventListener): void {
    this.coreBus.unsubscribe(type, listener);
  }

  /**
   * 触发事件
   */
  emit(type: EventType, data?: unknown, source?: string): void {
    const event: EventData = {
      type,
      timestamp: Date.now(),
      data,
      source,
    };
    this.coreBus.publish(type, event);
  }

  /**
   * 触发一次性事件
   */
  once(type: EventType, listener: EventListener): void {
    this.coreBus.once(type, listener);
  }

  /**
   * 移除所有事件监听器
   */
  removeAllListeners(type?: EventType): void {
    this.coreBus.unsubscribeAll(type);
  }

  /**
   * 获取事件监听器数量
   */
  listenerCount(type: EventType): number {
    return this.coreBus.listenerCount(type);
  }

  /**
   * 销毁事件总线
   */
  destroy(): void {
    this.coreBus.unsubscribeAll();
  }
}

/**
 * 创建默认的事件总线
 */
export function createEventBus(): EventBus {
  return new EventBus();
}
