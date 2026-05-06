// @ts-nocheck
/**
 * 自动压缩服务
 * 基于CC源码 cc_code/backend/services/compact/autoCompact.ts 实现
 *
 * 支持自动压缩边界检测、会话记忆压缩试路径、断路器模式、压缩后清理。
 */

import type { Message } from '@modules/chat/types/message';
import type { SessionMessage } from '@modules/session/models/SessionMessage';
import type {
  AutoCompactOptions,
  CompactState,
  CompactionResult,
  TokenWarningState,
} from './types';
import {
  calculateTokenWarningState,
  getAutoCompactThreshold,
  getBlockingLimit,
  getEffectiveContextWindowFromModel,
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  roughTokenCountEstimationForMessages,
} from './utils';
import { CompactServiceImpl } from './CompactService';
import { trySessionMemoryCompaction } from './sessionMemoryCompact';
import { runPostCompactCleanup } from './postCompactCleanup';

export interface AutoCompactTrackingState extends CompactState {
  lastRecompactInfo?: string;
}

export class AutoCompactService {
  private compactService: CompactServiceImpl;
  private compactStates: Map<string, AutoCompactTrackingState> = new Map();

  constructor(compactService?: CompactServiceImpl) {
    this.compactService = compactService || new CompactServiceImpl();
  }

  checkAndCompact(
    sessionId: string,
    messages: Message[],
    model: string
  ): {
    shouldCompact: boolean;
    warningState?: TokenWarningState;
    result?: CompactionResult;
  } {
    const effectiveContextWindow = getEffectiveContextWindowFromModel(model);
    const tokenUsage = this.estimateTokenUsage(messages);
    const warningState = calculateTokenWarningState(
      tokenUsage,
      model,
      effectiveContextWindow
    );

    if (!warningState.isAboveAutoCompactThreshold) {
      return { shouldCompact: false, warningState };
    }

    const state = this.getOrCreateCompactState(sessionId);
    state.turnCounter++;

    if (state.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
      return { shouldCompact: false, warningState };
    }

    return { shouldCompact: true, warningState };
  }

  async performAutoCompact(
    sessionId: string,
    messages: Message[],
    model: string
  ): Promise<{
    success: boolean;
    result?: CompactionResult;
    error?: string;
  }> {
    const state = this.getOrCreateCompactState(sessionId);

    try {
      const sessionMessages = messages as unknown as SessionMessage[];

      const smResult = await trySessionMemoryCompaction(
        sessionMessages,
        getAutoCompactThreshold(model)
      );

      if (smResult) {
        state.consecutiveFailures = 0;
        state.compacted = true;

        runPostCompactCleanup('repl_main_thread');

        return {
          success: true,
          result: {
            ...smResult,
            attachments: smResult.attachments,
            hookResults: [],
          },
        };
      }

      const compactResult = await this.compactService.compactConversation(
        sessionMessages,
        { isAutoCompact: true }
      );

      state.consecutiveFailures = 0;
      state.compacted = true;

      runPostCompactCleanup('repl_main_thread');

      return {
        success: true,
        result: {
          ...compactResult,
          attachments: compactResult.attachments || [],
          hookResults: compactResult.hookResults || [],
        },
      };
    } catch (error) {
      state.consecutiveFailures++;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private getOrCreateCompactState(sessionId: string): AutoCompactTrackingState {
    let state = this.compactStates.get(sessionId);
    if (!state) {
      state = {
        compacted: false,
        turnCounter: 0,
        turnId: `turn-${Date.now()}`,
        consecutiveFailures: 0,
      };
      this.compactStates.set(sessionId, state);
    }
    return state;
  }

  resetCompactState(sessionId: string): void {
    this.compactStates.delete(sessionId);
  }

  getCompactState(sessionId: string): AutoCompactTrackingState | undefined {
    return this.compactStates.get(sessionId);
  }

  setRecompactInfo(sessionId: string, info: string): void {
    const state = this.compactStates.get(sessionId);
    if (state) {
      state.lastRecompactInfo = info;
    }
  }

  private estimateTokenUsage(messages: Message[]): number {
    return roughTokenCountEstimationForMessages(messages);
  }
}

export function createAutoCompactService(
  compactService?: CompactServiceImpl
): AutoCompactService {
  return new AutoCompactService(compactService);
}
