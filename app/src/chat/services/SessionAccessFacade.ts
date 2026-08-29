// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * SessionAccessFacade — 会话子系统访问门面
 *
 * 封装 session/bootstrap 的 4 个入口，统一初始化顺序和生命周期：
 *   1. SessionActivityTracker  — 会话活动追踪（心跳/空闲/驱逐）
 *   2. SessionMemoryManager     — 会话记忆管理
 *   3. SessionStateHydrator     — 会话状态回灌
 *   4. SessionMemoryExtractor   — 会话记忆提炼
 *
 * ChatManager 通过此门面与 session 子系统交互，减少直接依赖。
 */
import { getLogger } from '@modules/monitoring';
import { resolveSessionsDir } from '@modules/core/paths';
import { SessionMemoryManager } from '../../session/memory/SessionMemoryManager';
import { globalEmbeddingManager } from '@modules/ai';
import { SessionActivityTracker } from '../../session/activity/SessionActivityTracker';
import { SessionStateHydrator } from '../../session/hydration/SessionStateHydrator';
import { SessionMemoryExtractor } from '../../session/memory/SessionMemoryExtractor';
import type { MemoryExtractionLLM } from '../../session/memory/SessionMemoryExtractor';
import { MEMORY_TEMPLATE } from '../../session/memory/memoryTemplate';
import type { ChatSession } from '../types/session';

const logger = getLogger('chat:session-facade');

export class SessionAccessFacade {
  private memoryManager: SessionMemoryManager | null = null;
  private activityTracker: SessionActivityTracker | null = null;
  private hydrator: SessionStateHydrator | null = null;

  // ============================================================
  // 活动追踪
  // ============================================================

  /** 初始化并启动会话活动追踪 */
  ensureActivityTracker(): void {
    if (!this.activityTracker) {
      this.activityTracker = new SessionActivityTracker({
        heartbeatIntervalMs: 30_000,
        idleTimeoutMs: 5 * 60 * 1000,
        evictTimeoutMs: 30 * 60 * 1000,
        maxActiveSessions: 5,
        pidDir: resolveSessionsDir() + '/pid',
      });
      this.activityTracker.start();
      logger.info('SessionActivityTracker started');
    }
  }

  /** 追踪会话活动开始 */
  trackActivityStart(sessionId: string): void {
    this.activityTracker?.startActivity(sessionId);
  }

  /** 追踪会话活动结束 */
  trackActivityEnd(sessionId: string): void {
    this.activityTracker?.stopActivity(sessionId);
  }

  // ============================================================
  // 状态回灌
  // ============================================================

  /** 获取或创建 SessionStateHydrator */
  private getHydrator(): SessionStateHydrator {
    if (!this.hydrator) {
      this.hydrator = new SessionStateHydrator();
    }
    return this.hydrator;
  }

  /** 从 transcript 恢复衍生状态 */
  hydrateSession(session: ChatSession): {
    todos?: unknown;
    recentFiles?: string[];
    recentDecisions?: unknown;
  } {
    return this.getHydrator().hydrate(session);
  }

  // ============================================================
  // 记忆管理
  // ============================================================

  /** 获取或创建 SessionMemoryManager */
  getMemoryManager(): SessionMemoryManager {
    if (!this.memoryManager) {
      this.memoryManager = new SessionMemoryManager(
        resolveSessionsDir(),
        undefined,
        globalEmbeddingManager
      );
      logger.info('SessionMemoryManager initialized (with EmbeddingManager)');
    }
    return this.memoryManager;
  }

  /** 创建会话记忆提炼器 */
  createMemoryExtractor(options?: MemoryExtractionLLM): SessionMemoryExtractor {
    return new SessionMemoryExtractor(
      options || {
        sendMessage: async () => '',
      }
    );
  }

  /** 获取记忆模板 */
  getMemoryTemplate(): string {
    return MEMORY_TEMPLATE;
  }
}
