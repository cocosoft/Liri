//
/**
 * 微压缩实现
 * 基于CC源码 cc_code/backend/services/compact/microCompact.ts 实现
 *
 * 微压缩在每次API请求前运行，负责：
 * 1. 时间型微压缩：当距上次助手消息间隔超过阈值时，清除旧的工具结果
 * 2. 可扩展的缓存微压缩路径（支持future cache-editing API）
 */

import type { SessionMessage, MessageType } from '@modules/session/models/SessionMessage';
import { roughTokenCountEstimation } from './utils';
import { getTimeBasedMCConfig } from './timeBasedMCConfig';
import {
  clearCompactWarningSuppression,
  suppressCompactWarning,
} from './compactWarningState';

export const TIME_BASED_MC_CLEARED_MESSAGE = '[Old tool result content cleared]';

const IMAGE_MAX_TOKEN_SIZE = 2000;

let pendingCacheEdits: PendingCacheEdits | null = null;

const COMPACTABLE_TOOLS = new Set<string>([
  'FileReadTool',
  'BashTool',
  'ShellTool',
  'PowerShellTool',
  'GrepTool',
  'GlobTool',
  'WebSearchTool',
  'WebFetchTool',
  'FileEditTool',
  'FileWriteTool',
]);

export interface PendingCacheEdits {
  trigger: 'auto';
  deletedToolIds: string[];
  baselineCacheDeletedTokens: number;
}

export interface MicrocompactResult {
  messages: SessionMessage[];
  compactionInfo?: {
    pendingCacheEdits?: PendingCacheEdits;
  };
}

function isToolResultMessage(msg: SessionMessage): boolean {
  return msg.type === 'tool' && !!msg.toolResult;
}

function getToolNameFromToolResult(msg: SessionMessage): string | null {
  if (!msg.toolResult || typeof msg.toolResult !== 'object') {
    return null;
  }
  return msg.toolResult.toolName || msg.toolResult.name || null;
}

function calculateToolResultTokens(msg: SessionMessage): number {
  if (!msg.toolResult) {
    return 0;
  }

  const content = typeof msg.toolResult === 'string'
    ? msg.toolResult
    : JSON.stringify(msg.toolResult);

  return roughTokenCountEstimation(content);
}

function collectCompactableToolIds(messages: SessionMessage[]): string[] {
  const ids: string[] = [];
  for (const msg of messages) {
    const toolName = getToolNameFromToolResult(msg);
    if (isToolResultMessage(msg) && toolName && COMPACTABLE_TOOLS.has(toolName)) {
      ids.push(msg.id);
    }
  }
  return ids;
}

function isMainThreadSource(querySource?: string): boolean {
  return !querySource || querySource.startsWith('repl_main_thread');
}

export function evaluateTimeBasedTrigger(
  messages: SessionMessage[],
  querySource?: string,
): { gapMinutes: number; config: ReturnType<typeof getTimeBasedMCConfig> } | null {
  const config = getTimeBasedMCConfig();
  if (!config.enabled || !querySource || !isMainThreadSource(querySource)) {
    return null;
  }

  const lastAssistant = [...messages].reverse().find((m) => m.type === 'assistant');
  if (!lastAssistant) {
    return null;
  }

  const gapMinutes =
    (Date.now() - lastAssistant.createdAt.getTime()) / 60_000;
  if (!Number.isFinite(gapMinutes) || gapMinutes < config.gapThresholdMinutes) {
    return null;
  }

  return { gapMinutes, config };
}

function maybeTimeBasedMicrocompact(
  messages: SessionMessage[],
  querySource?: string,
): MicrocompactResult | null {
  const trigger = evaluateTimeBasedTrigger(messages, querySource);
  if (!trigger) {
    return null;
  }
  const { gapMinutes, config } = trigger;

  const compactableIds = collectCompactableToolIds(messages);

  const keepRecent = Math.max(1, config.keepRecent);
  const keepSet = new Set(compactableIds.slice(-keepRecent));
  const clearSet = new Set(compactableIds.filter((id) => !keepSet.has(id)));

  if (clearSet.size === 0) {
    return null;
  }

  let tokensSaved = 0;
  const result: SessionMessage[] = messages.map((msg) => {
    if (!isToolResultMessage(msg) || !clearSet.has(msg.id)) {
      return msg;
    }

    if (msg.content === TIME_BASED_MC_CLEARED_MESSAGE) {
      return msg;
    }

    tokensSaved += calculateToolResultTokens(msg);
    return {
      ...msg,
      content: TIME_BASED_MC_CLEARED_MESSAGE,
      toolResult: undefined,
    };
  });

  if (tokensSaved === 0) {
    return null;
  }

  suppressCompactWarning();

  return { messages: result };
}

export function microcompactMessages(
  messages: SessionMessage[],
  querySource?: string,
): MicrocompactResult {
  clearCompactWarningSuppression();

  const timeBasedResult = maybeTimeBasedMicrocompact(messages, querySource);
  if (timeBasedResult) {
    return timeBasedResult;
  }

  return { messages };
}

export function resetMicrocompactState(): void {
  pendingCacheEdits = null;
}
