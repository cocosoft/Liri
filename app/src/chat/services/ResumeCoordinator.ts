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
 * ResumeCoordinator — 检查点/恢复门面（ChatManager 拆分第 2 步）
 *
 * 从 ChatManager.ts 提取：检查点 CRUD 与最新检查点检索。
 * resumeStream 生成器（深度耦合编排）仍留在 ChatManager，属后续待办。
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
import { createCheckpointService } from './SessionCheckpointService.js';
import { getLocalSession } from './ChatHelper';
import type { ChatSession, CreateSessionParams } from '../types/session.js';
import { SessionState } from '../types/session.js';

const logger = new Logger({
  module: 'chat:resumeCoordinator',
  level: LogLevel.INFO,
});

/**
 * ResumeCoordinator 门面依赖
 */
export interface ResumeCoordinatorDeps {
  checkpointService: ReturnType<typeof createCheckpointService>;
  /** 会话内存 Map（与 ChatManager 共享引用） */
  chatSessions: Map<string, ChatSession>;
  /** 回滚兜底创建会话委托 */
  createSession: (params: CreateSessionParams) => Promise<ChatSession>;
}

/**
 * 检查点/恢复门面
 */
export class ResumeCoordinator {
  private readonly checkpointService: ReturnType<
    typeof createCheckpointService
  >;
  private readonly chatSessions: Map<string, ChatSession>;
  private readonly createSessionDelegate: (
    params: CreateSessionParams
  ) => Promise<ChatSession>;

  constructor(deps: ResumeCoordinatorDeps) {
    this.checkpointService = deps.checkpointService;
    this.chatSessions = deps.chatSessions;
    this.createSessionDelegate = deps.createSession;
  }

  /**
   * 从本地缓存获取会话
   */
  private _getLocalSession(
    sessionId: string | null | undefined
  ): ChatSession | undefined {
    return getLocalSession(this.chatSessions, sessionId);
  }

  public async getLatestCheckpointMessages(
    sessionId: string
  ): Promise<Array<Record<string, unknown>> | null> {
    try {
      const cp = await this.checkpointService.getLatestCheckpoint(sessionId);
      if (cp && cp.messages && cp.messages.length > 0) {
        return cp.messages as unknown as Array<Record<string, unknown>>;
      }
      return null;
    } catch (e) {
      logger.warn('获取最新检查点失败', {
        sessionId,
        error: String(e),
      });
      return null;
    }
  }

  async createCheckpoint(sessionId: string, label?: string): Promise<string> {
    const session = this._getLocalSession(sessionId);
    if (!session) {
      throw new AppError(
        'Session not found',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1004'
      );
    }

    const cp = await this.checkpointService.saveCheckpointWithData(
      sessionId,
      session.messages,
      session.metadata,
      session.state,
      label
    );

    return cp.id;
  }

  async listCheckpoints(
    sessionId: string
  ): Promise<import('../types/checkpoint').SessionCheckpoint[]> {
    return this.checkpointService.listCheckpoints(sessionId);
  }

  async rollbackToCheckpoint(checkpointId: string): Promise<{
    session: ChatSession;
    diff: import('../types/checkpoint').CheckpointDiff;
  }> {
    const checkpoint = await this.checkpointService.getCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new AppError(
        'Checkpoint not found',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1005'
      );
    }

    await this.checkpointService.rollbackToCheckpoint(checkpointId, {
      messages: checkpoint.messages || [],
      metadata: checkpoint.metadata || { title: '' },
      state: SessionState.ACTIVE,
    });

    return {
      session:
        this._getLocalSession(checkpoint.sessionId) ||
        (await this.createSessionDelegate({ title: 'Rollback Session' })),
      diff: {
        addedMessages: 0,
        removedMessages: checkpoint.messages?.length || 0,
        stateChanged: true,
        metadataChanged: true,
        summary: `Rolled back to checkpoint: ${checkpointId}`,
      },
    };
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    return this.checkpointService.deleteCheckpoint(checkpointId);
  }

  async getLatestCheckpoint(
    sessionId: string
  ): Promise<import('../types/checkpoint').SessionCheckpoint | null> {
    return this.checkpointService.getLatestCheckpoint(sessionId);
  }
}
