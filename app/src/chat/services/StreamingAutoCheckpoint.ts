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

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { SessionCheckpointService } from './SessionCheckpointService';
import type { SessionCheckpoint } from '../types/checkpoint';
import type { Message } from '../types/message';
import type { SessionMetadata, SessionState } from '../types/session';
import type { ToolCallSpec } from '@modules/runtime/api/CoreAPI';

const logger = new Logger({
  module: 'chat:streamingAutoCheckpoint',
  level: LogLevel.INFO,
});

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
  sessionState: SessionState;
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

    logger.info('流式自动检查点已创建', {
      sessionId: this.sessionId,
      stepIndex: checkpoint.id,
      mode: isFull ? 'full' : 'delta',
      version: this.version,
      messageCount: isFull
        ? state.messagesSnapshot.length
        : state.newMessagesSinceLastCheckpoint.length,
    });

    return checkpoint;
  }

  /** 恢复：从最新自动检查点重建生成器状态 */
  async restore(): Promise<RestoreResult | null> {
    const latest = await this.checkpointService.getLatestCheckpoint(
      this.sessionId
    );
    if (!latest) return null;

    const meta = latest.metadata as unknown as Record<string, unknown>;
    if (!meta?.[META_KEY]) return null;

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

    logger.info('从自动检查点恢复', {
      sessionId: this.sessionId,
      checkpointId: latest.id,
      stepIndex: state.stepIndex,
      completedToolCount: state.completedToolCallIds.length,
    });

    return {
      checkpoint: latest,
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
}
