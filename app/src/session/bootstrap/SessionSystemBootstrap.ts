// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Session System Bootstrap
 *
 * 在 ChatManager.initialize() 中调用，将 Step 1-2 的新模块接入运行时。
 * 极小化侵入：不修改 ChatManager 构造器，仅通过 initialize() 注册。
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { resolveSessionsDir } from '@modules/core/paths';
import { SessionMemoryManager } from '../memory/SessionMemoryManager';
import { SessionActivityTracker } from '../activity/SessionActivityTracker';
import { SessionStateHydrator } from '../hydration/SessionStateHydrator';
import type { ChatSession } from '../../chat/types/session';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'session:bootstrap',
});

/** 全局单例，跨会话共享 */
let memoryManager: SessionMemoryManager | null = null;
let activityTracker: SessionActivityTracker | null = null;
let hydrator: SessionStateHydrator | null = null;

/**
 * 获取全局 SessionStateHydrator（懒初始化）
 */
export function getSessionStateHydrator(): SessionStateHydrator {
  if (!hydrator) {
    hydrator = new SessionStateHydrator();
  }
  return hydrator;
}

/**
 * 获取全局 SessionMemoryManager（懒初始化）
 */
export function getSessionMemoryManager(): SessionMemoryManager {
  if (!memoryManager) {
    memoryManager = new SessionMemoryManager(resolveSessionsDir());
    logger.info('SessionMemoryManager initialized');
  }
  return memoryManager;
}

/**
 * 获取全局 SessionActivityTracker（懒初始化）
 */
export function getSessionActivityTracker(): SessionActivityTracker {
  if (!activityTracker) {
    activityTracker = new SessionActivityTracker({
      heartbeatIntervalMs: 30_000,
      idleTimeoutMs: 5 * 60 * 1000,
      evictTimeoutMs: 30 * 60 * 1000,
      maxActiveSessions: 5,
      pidDir: resolveSessionsDir() + '/pid',
    });
    activityTracker.start();
    logger.info('SessionActivityTracker started');
  }
  return activityTracker;
}

/**
 * 为新会话初始化记忆文件
 */
export function initSessionMemory(sessionId: string): void {
  const mm = getSessionMemoryManager();
  mm.initMemory(sessionId);
}

/**
 * 追踪会话活动开始
 */
export function trackSessionStart(sessionId: string): void {
  const at = getSessionActivityTracker();
  at.startActivity(sessionId);
}

/**
 * 追踪会话活动结束
 */
export function trackSessionEnd(sessionId: string): void {
  if (activityTracker) {
    activityTracker.stopActivity(sessionId);
  }
}
