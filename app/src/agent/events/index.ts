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
 * Agent Internal Events
 * 事件系统桥接模块，统一事件总线到 @modules/core/events/EventBus
 *
 * 新代码请直接使用 globalEventBus（从本模块或直接从 @modules/core/events/EventBus 导入）：
 *   import { globalEventBus } from './events';
 *   globalEventBus.publish('agent:execute:start', { taskId });
 *   globalEventBus.subscribe('agent:execute:start', (data) => { ... });
 *
 * InternalEventBus 保留为桥接包装器，保持与 agent.ts 等旧调用方
 * 的构造参数类型兼容，将在未来版本中移除。
 */

import type {
  EventPriority,
  AgentEvent,
  EventSubscription,
  EventHandler,
  EventStats,
} from './types';
import { AgentEventType } from './types';
import { getLogger } from '@modules/monitoring';
import {
  globalEventBus,
  EventBusImpl,
  type EventListener,
} from '@modules/core/events/EventBus';

const logger = getLogger('agent-events');

// ========== 统一事件总线桥接导出 ==========
// 新代码应直接使用 globalEventBus
export { globalEventBus, EventBusImpl } from '@modules/core/events/EventBus';

// ========== Agent 事件类型导出（保持向后兼容） ==========
export {
  AgentEventType,
  type EventPriority,
  type AgentEvent,
  type EventSubscription,
  type EventHandler,
  type EventStats,
} from './types';
export { SSEEncoder } from './SSEEncoder';
export type { SSEFrame } from './SSEEncoder';

/**
 * InternalEventBus 桥接包装器
 *
 * @deprecated 请使用 globalEventBus（EventBusImpl）替代。
 *   本类保留仅为兼容旧调用方（如 agent.ts 构造参数类型）。
 *   所有操作委托给 globalEventBus。
 */
export class InternalEventBus {
  private maxHistorySize: number;

  constructor(maxHistorySize: number = 1000) {
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * 发射事件
   * 委托给 globalEventBus.publish()
   */
  async emit(
    type: string,
    data?: unknown,
    options?: { source?: string; target?: string; priority?: EventPriority }
  ): Promise<AgentEvent> {
    const event: AgentEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      source: options?.source ?? 'system',
      target: options?.target,
      data,
      priority: options?.priority ?? 'normal',
      timestamp: Date.now(),
    };

    globalEventBus.publish(type, event);

    return event;
  }

  /**
   * 获取统计信息
   */
  getStats(): EventStats {
    const eventNames = globalEventBus.getEventNames();
    const eventsByType: Record<string, number> = {};
    let totalSubs = 0;

    for (const name of eventNames) {
      if (name === '*') continue;
      const count = globalEventBus.listenerCount(name);
      eventsByType[name] = count;
      totalSubs += count;
    }

    return {
      totalEmitted: 0,
      totalHandled: 0,
      activeSubscriptions: totalSubs,
      eventsByType,
    };
  }
}
