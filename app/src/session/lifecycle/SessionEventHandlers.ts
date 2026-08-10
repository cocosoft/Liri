// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Session Event Handlers
 *
 * 监听 SessionLifecycleEventBus 上的生命周期事件，
 * 驱动 SessionMemory、ActivityTracker、Hydrator 等基础设施模块。
 *
 * 在 ChatManager.initialize() 中调用 connect()，极轻量集成。
 */

import { getLogger } from '@modules/monitoring';
import type { SessionLifecycleEventBus } from '../lifecycle/SessionLifecycleEventBus';
import type { SessionLifecycleEvent } from '../lifecycle/SessionLifecycleEvent';
import {
  initSessionMemory,
  getSessionActivityTracker,
} from '../bootstrap/SessionSystemBootstrap';

const logger = getLogger('session:handlers');

let connected = false;

/**
 * 连接生命周期事件到基础设施模块
 * 外部通过 getGlobalEventBus() 获取 eventBus 传入
 */
export function connectSessionHandlers(
  eventBus: SessionLifecycleEventBus
): void {
  if (connected) {
    logger.debug('SessionEventHandlers already connected, skipping');
    return;
  }
  connected = true;

  // 会话创建 → 初始化记忆 + 开始追踪
  eventBus.subscribe('session:created', (event: SessionLifecycleEvent) => {
    initSessionMemory(event.sessionId);
    getSessionActivityTracker().startActivity(event.sessionId);
    logger.debug('session:created', { sessionId: event.sessionId });
  });

  // 会话激活 → 更新心跳
  eventBus.subscribe('session:activated', (event: SessionLifecycleEvent) => {
    getSessionActivityTracker().startActivity(event.sessionId);
    logger.debug('session:activated', { sessionId: event.sessionId });
  });

  // 会话恢复 → 更新心跳
  eventBus.subscribe('session:resumed', (event: SessionLifecycleEvent) => {
    getSessionActivityTracker().startActivity(event.sessionId);
    logger.debug('session:resumed', { sessionId: event.sessionId });
  });

  // 会话删除/归档/过期 → 停止追踪
  const stopEvents = [
    'session:deleted',
    'session:archived',
    'session:expired',
  ] as const;
  for (const eventType of stopEvents) {
    eventBus.subscribe(eventType, (event: SessionLifecycleEvent) => {
      getSessionActivityTracker().stopActivity(event.sessionId);
      logger.debug(eventType, { sessionId: event.sessionId });
    });
  }

  logger.info('SessionEventHandlers connected');
}
