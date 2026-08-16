// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Session System Bootstrap
 *
 * 在 ChatManager.initialize() 中调用，将 Step 1-2 的新模块接入运行时。
 * 极小化侵入：不修改 ChatManager 构造器，仅通过 initialize() 注册。
 */

import { getLogger } from '@modules/monitoring';
import { resolveSessionsDir } from '@modules/core/paths';
import { configManager } from '@modules/config';
import { SessionMemoryManager } from '../memory/SessionMemoryManager';
import { globalEmbeddingManager } from '../../ai/embedding/EmbeddingManager';
import { SessionActivityTracker } from '../activity/SessionActivityTracker';
import { SessionStateHydrator } from '../hydration/SessionStateHydrator';
import type { ChatSession } from '../../chat/types/session';
import path from 'path';

const logger = getLogger('session:bootstrap');

/** 并发活跃会话上限（P2-29 修复：不再硬编码，可用 SESSION_MAX_ACTIVE 环境变量调整） */
const MAX_ACTIVE_SESSIONS = parseInt(
  configManager.env('SESSION_MAX_ACTIVE') || '5',
  10
);

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
    memoryManager = new SessionMemoryManager(
      resolveSessionsDir(),
      undefined,
      globalEmbeddingManager
    );
    logger.info('SessionMemoryManager initialized (with EmbeddingManager)');
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
      maxActiveSessions: MAX_ACTIVE_SESSIONS,
      pidDir: path.join(resolveSessionsDir(), 'pid'),
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
  try {
    const mm = getSessionMemoryManager();
    mm.initMemory(sessionId);
  } catch (err) {
    // P2-29 修复：记忆初始化失败不应炸到调用方（trackSessionStart 链路），降级告警
    logger.warn('会话记忆初始化失败（非致命）', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * 追踪会话活动开始
 */
export function trackSessionStart(sessionId: string): void {
  try {
    const at = getSessionActivityTracker();
    at.startActivity(sessionId);
  } catch (err) {
    // P2-29 修复：活动追踪失败不阻塞会话启动主流程
    logger.warn('会话活动追踪启动失败（非致命）', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * 追踪会话活动结束
 */
export function trackSessionEnd(sessionId: string): void {
  if (activityTracker) {
    activityTracker.stopActivity(sessionId);
  }
}
