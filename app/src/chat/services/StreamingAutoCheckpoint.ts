// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * StreamingAutoCheckpoint — 流式执行中的自动检查点
 *
 * P2-1: 在 ChatManager 工具循环的每个 tool_call 完成后自动写入检查点，
 * 支持增量存储（每 10 步一次全量）和生成器状态恢复。
 *
 * 复用已有的 SessionCheckpointService + CheckpointDatabase（SQLite 持久化），
 * 通过 metadata.streamingAutoCheckpoint 标记区分手动/自动检查点。
 */

import { getLogger } from '@modules/monitoring';
import { isCheckpointLogEnabled } from '@modules/config';
import { handleError } from '@modules/error';
import type { SessionCheckpointService } from './SessionCheckpointService';
import type { SessionCheckpoint } from '../types/checkpoint';
import type { Message } from '../types/message';
import type { SessionMetadata, DataSessionStatus } from '../types/session';
import type { ToolCallSpec } from '@modules/runtime/api/CoreAPI';

const logger = getLogger('chat:streamingAutoCheckpoint');

// ── 类型 ──────────────────────────────────────────────────────────

export interface ToolCompletedState {
  /** 本轮新增的消息（tool_call assistant + tool_result），用于增量检查点 */
  newMessagesSinceLastCheckpoint: Message[];
  /** 完整的消息快照，用于全量检查点 */
  messagesSnapshot: Message[];
  /** 本轮完成后待执行的剩余 tool calls */
  currentToolCalls: ToolCallSpec[];
  /** 所有已完成的 tool_call ID */
  completedToolCallIds: string[];
  /** 生成器执行状态 */
  generatorState: {
    toolTurnCount: number;
    llmCallCount: number;
  };
  /** 会话元数据 */
  metadata: {
    model?: string;
    tokenUsage?: Record<string, number>;
  };
  /** 会话状态 */
  sessionState: DataSessionStatus;
}

export interface RestoreResult {
  checkpoint: SessionCheckpoint;
  stepIndex: number;
  completedToolCallIds: string[];
  generatorState: {
    toolTurnCount: number;
    llmCallCount: number;
  };
}

// ── 元数据键名常量 ────────────────────────────────────────────────

/** metadata 中标记自动检查点的字段 */
const META_KEY = 'streamingAutoCheckpoint';
/** description JSON 中存储的恢复状态字段 */
const DESC_KEY = 'autoCheckpointState';

// ── 实现 ──────────────────────────────────────────────────────────

export class StreamingAutoCheckpoint {
  private checkpointService: SessionCheckpointService;
  private sessionId: string;
  private stepIndex = 0;
  private lastFullStep = 0;
  private version = 0;

  constructor(checkpointService: SessionCheckpointService, sessionId: string) {
    this.checkpointService = checkpointService;
    this.sessionId = sessionId;
  }

  /** 每个 tool_call 完成后调用，写入自动检查点 */
  async onToolCompleted(state: ToolCompletedState): Promise<SessionCheckpoint> {
    const isFull =
      this.stepIndex === 0 || this.stepIndex - this.lastFullStep >= 10;
    this.version++;

    const description = JSON.stringify({
      [DESC_KEY]: {
        stepIndex: this.stepIndex,
        version: this.version,
        mode: isFull ? 'full' : 'delta',
        parentVersion: isFull ? 0 : this.version - 1,
        completedToolCallIds: state.completedToolCallIds,
        generatorState: state.generatorState,
      },
    });

    const metadata: SessionMetadata = {
      ...state.metadata,
      [META_KEY]: true,
    } as unknown as SessionMetadata;

    const checkpoint = await this.checkpointService.saveCheckpointWithData(
      this.sessionId,
      isFull ? state.messagesSnapshot : state.newMessagesSinceLastCheckpoint,
      metadata,
      state.sessionState,
      `auto_step_${this.stepIndex}`,
      description,
      true, // autoCreated
      state.messagesSnapshot.length
    );

    this.stepIndex++;
    if (isFull) this.lastFullStep = this.stepIndex;

    if (isCheckpointLogEnabled()) {
      logger.info('流式自动检查点已创建', {
        sessionId: this.sessionId,
        stepIndex: checkpoint.id,
        mode: isFull ? 'full' : 'delta',
        version: this.version,
        messageCount: isFull
          ? state.messagesSnapshot.length
          : state.newMessagesSinceLastCheckpoint.length,
      });
    }

    return checkpoint;
  }

  /** 恢复：从自动检查点链重建完整消息 + 生成器状态 */
  async restore(): Promise<RestoreResult | null> {
    // BUG-A 修复（2026-08-26）：delta 检查点恢复必须沿父链合并——
    // 原 restore 只取最新一条检查点，若为 delta（仅存最近 1-2 条增量消息），
    // resumeStream 用 checkpoint.messages 覆盖会话消息后完整历史丢失。
    // 现取全部 auto 检查点：从最近 full 快照 + 其后的 delta 增量合并去重。
    const checkpoints = await this.checkpointService.listCheckpoints(
      this.sessionId
    );
    const autoCheckpoints = checkpoints
      .filter(
        (c) =>
          (c.metadata as unknown as Record<string, unknown>)?.[META_KEY] ===
          true
      )
      .sort((a, b) => a.createdAt - b.createdAt);
    if (autoCheckpoints.length === 0) return null;

    const latest = autoCheckpoints[autoCheckpoints.length - 1];

    let state: {
      stepIndex: number;
      completedToolCallIds: string[];
      toolTurnCount: number;
      llmCallCount: number;
    };
    try {
      const desc = JSON.parse(latest.description || '{}');
      const autoState = desc[DESC_KEY];
      if (!autoState) return null;
      state = autoState;
    } catch (parseErr) {
      handleError(parseErr, {
        module: 'chat:streamingAutoCheckpoint',
        action: 'restoreParseDescription',
        context: { sessionId: this.sessionId, checkpointId: latest.id },
      });
      return null;
    }

    // 定位最近的全量检查点；无全量则从首个 auto 检查点开始合并
    const parseMode = (description?: string): 'full' | 'delta' => {
      try {
        const autoState = JSON.parse(description || '{}')[DESC_KEY];
        return autoState?.mode === 'full' ? 'full' : 'delta';
      } catch (parseErr) {
        // KB-CKPT-MODE-LOG（2026-08-29）：与上方 restoreParseDescription 的 handleError
        // 处理不一致——此处分支静默回退 delta
        logger.warn('检查点 mode 解析失败，回退 delta', {
          sessionId: this.sessionId,
          error:
            parseErr instanceof Error ? parseErr.message : String(parseErr),
        });
        return 'delta';
      }
    };
    let mergeStartIdx = 0;
    for (let i = autoCheckpoints.length - 1; i >= 0; i--) {
      if (parseMode(autoCheckpoints[i].description) === 'full') {
        mergeStartIdx = i;
        break;
      }
    }
    // 合并：full 快照消息 + 后续 delta 增量，按消息 id 去重
    const byId = new Map<string, Message>();
    for (let i = mergeStartIdx; i < autoCheckpoints.length; i++) {
      for (const msg of autoCheckpoints[i].messages) {
        byId.set(msg.id, msg);
      }
    }
    const mergedMessages = Array.from(byId.values());

    if (isCheckpointLogEnabled()) {
      logger.info('从自动检查点链恢复', {
        sessionId: this.sessionId,
        checkpointId: latest.id,
        stepIndex: state.stepIndex,
        completedToolCount: state.completedToolCallIds.length,
        autoCheckpointCount: autoCheckpoints.length,
        mergeStartIdx,
        mergedMessageCount: mergedMessages.length,
        latestMessageCount: latest.messages.length,
      });
    }

    return {
      checkpoint: {
        ...latest,
        messages: mergedMessages,
      },
      stepIndex: state.stepIndex,
      completedToolCallIds: state.completedToolCallIds,
      generatorState: {
        toolTurnCount: state.toolTurnCount,
        llmCallCount: state.llmCallCount,
      },
    };
  }

  /** 获取当前步骤序号 */
  get currentStep(): number {
    return this.stepIndex;
  }

  /**
   * 恢复 stepIndex（BUG-A2 修复 2026-08-26）：resumeStream 恢复会话后调用，
   * 新实例默认 stepIndex=0 会导致恢复后的全量/delta 检查点节奏错位
   *（本应第 11 步全量的被当作第 1 步全量）
   */
  restoreStepIndex(stepIndex: number): void {
    this.stepIndex = stepIndex;
    this.lastFullStep = stepIndex;
  }
}
