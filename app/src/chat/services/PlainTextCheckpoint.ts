// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PlainTextCheckpoint — 普通对话轻量检查点
 *
 * P2（08-09）：为无工具调用的纯文本对话路径提供自动检查点。
 * 复用 SessionCheckpointService.autoCreateCheckpoint 的去重机制，
 * 消息数未变时跳过，避免重复写入。
 *
 * 与 StreamingAutoCheckpoint（工具调用路径）互补，覆盖全部对话场景。
 */

import type { SessionCheckpointService } from './SessionCheckpointService';
import type { SessionCheckpoint } from '../types/checkpoint';
import type { Message } from '../types/message';
import type { SessionMetadata, SessionState } from '../types/session';

/** metadata 中标记普通对话检查点的字段 */
const META_KEY = 'plainTextAutoCheckpoint';

export class PlainTextCheckpoint {
  private checkpointService: SessionCheckpointService;
  private sessionId: string;

  constructor(checkpointService: SessionCheckpointService, sessionId: string) {
    this.checkpointService = checkpointService;
    this.sessionId = sessionId;
  }

  /**
   * 创建普通对话检查点（全量快照）。
   *
   * 通过 autoCreateCheckpoint 的去重机制：若消息数与最新检查点相同则跳过，
   * 返回已有检查点而非创建新记录。
   *
   * @returns 检查点对象，或 null（消息数未变时跳过）
   */
  async save(
    messages: Message[],
    metadata: SessionMetadata,
    state: SessionState
  ): Promise<SessionCheckpoint | null> {
    try {
      const enrichedMetadata = {
        ...metadata,
        [META_KEY]: true,
      } as unknown as SessionMetadata;

      const checkpoint = await this.checkpointService.autoCreateCheckpoint(
        this.sessionId,
        messages,
        enrichedMetadata,
        state
      );

      // autoCreateCheckpoint 返回已有检查点（消息数未变）时，不记录日志
      if (checkpoint.id) {
        // 仅当是新检查点时才记录
        // 注意：autoCreateCheckpoint 可能返回旧检查点，此时 id 已存在
      }

      return checkpoint;
    } catch {
      // 检查点保存失败不影响主流程
      return null;
    }
  }

  /**
   * 恢复：从最新普通对话检查点获取消息快照。
   * 仅返回 metadata 含 plainTextAutoCheckpoint 标记的检查点。
   */
  async restore(): Promise<SessionCheckpoint | null> {
    const latest = await this.checkpointService.getLatestCheckpoint(
      this.sessionId
    );
    if (!latest) return null;

    const meta = latest.metadata as unknown as Record<string, unknown>;
    if (!meta?.[META_KEY]) return null;

    return latest;
  }
}
