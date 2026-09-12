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
 * ContextCompactor — 上下文压缩门面（ChatManager 拆分第 3 步）
 *
 * 从 ChatManager.ts 提取：压缩边界检测 / 会话压缩 / 压缩服务访问。
 * _compressToolHistory/_estimateArrayTokens 与编排循环紧耦合，暂留 ChatManager。
 */

import {
  CompactServiceImpl,
  type CompactBoundary,
  type CompactArtifact,
} from '../../services/compact/CompactService.js';
import {
  compactionLockStore,
  type CompactionLockStore,
} from '@modules/context';
import type { SessionMessage } from '@modules/session';
import type { ChatSession } from '../types/session.js';
import { getLocalSession } from './ChatHelper';
import type { SessionCurrentIdPort } from './SessionLifecycleManager';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('chat:contextCompactor');

/**
 * ContextCompactor 门面依赖
 */
export interface ContextCompactorDeps {
  compactService: CompactServiceImpl;
  /** 会话内存 Map（与 ChatManager 共享引用） */
  chatSessions: Map<string, ChatSession>;
  /** 当前会话 ID 端口 */
  currentSessionIdRef: SessionCurrentIdPort;
  /**
   * 压缩锁（D4 收敛）：**必须与 `CompactionOrchestrator` 共用同一实例**，否则两条压缩路径
   * 仍会并发改写同一会话的消息集。缺省用全局单例；测试可注入临时目录实例。
   */
  lockStore?: CompactionLockStore;
}

/**
 * 上下文压缩门面
 */
export class ContextCompactor {
  private readonly compactService: CompactServiceImpl;
  private readonly chatSessions: Map<string, ChatSession>;
  private readonly currentId: SessionCurrentIdPort;
  private readonly lockStore: CompactionLockStore;

  constructor(deps: ContextCompactorDeps) {
    this.compactService = deps.compactService;
    this.chatSessions = deps.chatSessions;
    this.currentId = deps.currentSessionIdRef;
    this.lockStore = deps.lockStore ?? compactionLockStore;
  }

  /**
   * 从本地缓存获取会话
   */
  private _getLocalSession(
    sessionId: string | null | undefined
  ): ChatSession | undefined {
    return getLocalSession(this.chatSessions, sessionId);
  }

  /**
   * 检查是否需要压缩
   * @param sessionId 会话ID
   * @returns 压缩边界信息或null
   */
  async checkCompactBoundary(
    sessionId?: string
  ): Promise<CompactBoundary | null> {
    const targetSessionId =
      sessionId || this._getLocalSession(this.currentId.get())?.id;
    if (!targetSessionId) {
      return null;
    }

    const session = this._getLocalSession(targetSessionId);
    if (!session) {
      return null;
    }

    const sessionMessages: SessionMessage[] = session.messages.map((msg) => ({
      id: msg.id,
      type: msg.role as SessionMessage['type'],
      content:
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content),
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    })) as unknown as SessionMessage[];

    return this.compactService.detectCompactBoundary(
      targetSessionId,
      sessionMessages
    );
  }

  /**
   * 执行会话压缩
   * @param sessionId 会话ID
   * @returns 压缩产物列表
   */
  async compactSession(sessionId?: string): Promise<CompactArtifact[]> {
    const targetSessionId =
      sessionId || this._getLocalSession(this.currentId.get())?.id;
    if (!targetSessionId) {
      return [];
    }

    const session = this._getLocalSession(targetSessionId);
    if (!session) {
      return [];
    }

    // 转换消息格式
    const sessionMessages: SessionMessage[] = session.messages.map((msg) => ({
      id: msg.id,
      type: msg.role as SessionMessage['type'],
      content:
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content),
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    })) as unknown as SessionMessage[];

    // D4 收敛（2026-09-12）：手动压缩路径（`/compact` 命令 + `POST /v1/sessions/:id/compact`）
    // 此前**不持锁**，与 `CompactionOrchestrator` 的自动压缩可并发改写同一会话的消息集
    // —— 即审计表结论②的"互相覆盖"。现与 A **共用同一把锁**：
    // 拿不到锁 = 该会话正被另一条路径压缩 → 本次**跳过**并明确告警，绝不并发写回。
    const lockId = this.lockStore.tryAcquire(targetSessionId);
    if (lockId === null) {
      logger.warn(
        'compaction:manual_rejected_concurrent — 会话正在被另一条压缩路径处理，跳过本次手动压缩',
        {
          impl: 'compactServiceImpl',
          sessionId: targetSessionId,
          messageCount: sessionMessages.length,
        }
      );
      return [];
    }

    logger.info('compaction:manual_start — 手动压缩开始（持锁）', {
      impl: 'compactServiceImpl',
      sessionId: targetSessionId,
      compactionId: lockId,
      messageCount: sessionMessages.length,
    });

    try {
      const artifacts = await this.compactService.performCompact(
        targetSessionId,
        sessionMessages
      );

      // 如果有压缩产物，注入到会话中
      if (artifacts.length > 0) {
        await this.compactService.reinjectArtifacts(targetSessionId, artifacts);
      }

      logger.info('compaction:manual_done — 手动压缩结束', {
        impl: 'compactServiceImpl',
        sessionId: targetSessionId,
        compactionId: lockId,
        artifactCount: artifacts.length,
      });
      return artifacts;
    } finally {
      // 无论成功/抛错都必须释放，避免会话被永久"锁死"（残留锁虽有 TTL 兜底，但会拒掉后续压缩）
      this.lockStore.release(targetSessionId, lockId);
    }
  }

  /**
   * 获取压缩服务
   * @returns 压缩服务实例
   */
  getCompactService(): CompactServiceImpl {
    return this.compactService;
  }
}
