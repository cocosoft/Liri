// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Session Hooks
 *
 * 对标 BA_REF sessionHooks.ts，提供可插拔的会话生命周期钩子。
 * 基于现有 SessionLifecycleEventBus，提供声明式注册 API。
 *
 * 用法：
 *   const hooks = new SessionHooks(eventBus);
 *   hooks.on('session:created', (event) => { ... });
 *   hooks.on('session:deleted', (event) => { ... });
 *
 * 设计原则：薄封装层，不引入新的事件系统，直接复用已有的 EventBus。
 */

import type { SessionLifecycleEventBus } from './SessionLifecycleEventBus';
import type {
  SessionEventType,
  SessionLifecycleEvent,
} from './SessionLifecycleEvent';

export { SessionEventType, SessionLifecycleEvent };

export type HookHandler = (
  event: SessionLifecycleEvent
) => void | Promise<void>;

/**
 * 会话生命周期钩子注册表
 */
export class SessionHooks {
  private eventBus: SessionLifecycleEventBus;

  constructor(eventBus: SessionLifecycleEventBus) {
    this.eventBus = eventBus;
  }

  /**
   * 注册事件钩子
   * @param type 事件类型，'*' 表示监听所有事件
   * @param handler 处理函数
   * @returns 取消注册的函数
   */
  on(type: SessionEventType | '*', handler: HookHandler): () => void {
    const subscription = this.eventBus.subscribe(
      type,
      handler as (event: SessionLifecycleEvent) => void | Promise<void>
    );
    return () => subscription.unsubscribe();
  }

  /**
   * 注册一次性钩子（触发后自动取消）
   */
  once(type: SessionEventType | '*', handler: HookHandler): void {
    this.eventBus.once(type, handler);
  }

  /**
   * 发布事件
   */
  emit(event: SessionLifecycleEvent): void {
    this.eventBus.publish(event.type, event);
  }
}
