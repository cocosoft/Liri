/**
 * SnipEngine — Tier 2 轮次裁剪（Phase 3）
 * 对标 PilotDeck SnipEngine
 *
 * 裁剪中间轮次，保留头部 N 轮 + 尾部 N 轮
 * 零 LLM 调用
 */
import type { ChatMessage } from '../../ai/models/types';
import {
  ensureTrailingUserMessage,
  stripUnpairedToolCalls,
  stripUnpairedToolResults,
} from './toolPairIntegrity';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'context:compaction:snip',
  level: LogLevel.INFO,
});

export interface SnipEngineOptions {
  keepHeadTurns?: number;
  keepTailTurns?: number;
  enabled?: boolean;
}

export interface SnipResult {
  messages: ChatMessage[];
  applied: boolean;
  turnsSnipped: number;
}

const DEFAULT_OPTIONS: Required<SnipEngineOptions> = {
  keepHeadTurns: 2,
  keepTailTurns: 4,
  enabled: true,
};

/**
 * 创建 snip 边界标记消息
 */
function createSnipBoundary(
  turnsSnipped: number,
  headTurns: number,
  tailTurns: number
): string {
  return `<snip-boundary>
  ${turnsSnipped} 轮对话被裁剪（保留前 ${headTurns} 轮 + 后 ${tailTurns} 轮）
</snip-boundary>`;
}

/**
 * 判断消息是否为 snip 边界标记
 */
export function isSnipBoundaryMessage(content: string): boolean {
  return content.includes('<snip-boundary>');
}

/**
 * 按用户消息分组为轮次（不按 system 消息分组，避免记忆注入/跨轮摘要产生虚假轮次）
 */
function groupByTurns(messages: ChatMessage[]): number[][] {
  const turns: number[][] = [];
  let currentTurn: number[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'user') {
      if (currentTurn.length > 0) {
        turns.push(currentTurn);
      }
      currentTurn = [i];
    } else {
      currentTurn.push(i);
    }
  }
  if (currentTurn.length > 0) {
    turns.push(currentTurn);
  }

  return turns;
}

/**
 * Tier 2 轮次裁剪：保留头部 + 尾部轮次，裁剪中间
 */
export function snipMessages(
  messages: ChatMessage[],
  options: SnipEngineOptions = {}
): SnipResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!opts.enabled || messages.length === 0) {
    return { messages, applied: false, turnsSnipped: 0 };
  }

  const turns = groupByTurns(messages);
  if (turns.length <= opts.keepHeadTurns + opts.keepTailTurns) {
    return { messages, applied: false, turnsSnipped: 0 };
  }

  // 收集保留的索引
  const keepIndices = new Set<number>();

  // 保留头部轮次
  for (let t = 0; t < Math.min(opts.keepHeadTurns, turns.length); t++) {
    for (const idx of turns[t]) keepIndices.add(idx);
  }

  // 保留尾部轮次
  const tailStart = Math.max(
    opts.keepHeadTurns,
    turns.length - opts.keepTailTurns
  );
  for (let t = tailStart; t < turns.length; t++) {
    for (const idx of turns[t]) keepIndices.add(idx);
  }

  const turnsSnipped = turns.length - opts.keepHeadTurns - opts.keepTailTurns;

  // 插入边界标记在 head 和 tail 之间
  const headLastIdx =
    opts.keepHeadTurns > 0
      ? (turns[opts.keepHeadTurns - 1]?.[
          turns[opts.keepHeadTurns - 1].length - 1
        ] ?? 0)
      : 0;

  const result: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (keepIndices.has(i)) {
      result.push(messages[i]);
    }
    // 在 head 最后一条之后插入边界标记
    if (i === headLastIdx && turnsSnipped > 0) {
      // BUG-F fix: use 'user' role — LLM APIs require system messages at the beginning only
      result.push({
        role: 'user',
        content: createSnipBoundary(
          turnsSnipped,
          opts.keepHeadTurns,
          opts.keepTailTurns
        ),
      } as unknown as ChatMessage);
    }
  }

  // 清理孤立的工具调用/结果
  // 分别构建两个集合：result ID（有匹配结果）和 call ID（有匹配调用）
  const pairedResultIds = new Set<string>();
  const pairedCallIds = new Set<string>();
  for (const msg of result) {
    const tcId = (msg as unknown as Record<string, unknown>).tool_call_id as
      | string
      | undefined;
    if (tcId) pairedResultIds.add(tcId);

    const toolCalls = (msg as unknown as Record<string, unknown>).tool_calls as
      | Array<{ id?: string }>
      | undefined;
    if (toolCalls) {
      for (const tc of toolCalls) {
        if (tc.id) pairedCallIds.add(tc.id);
      }
    }
  }

  let cleaned = stripUnpairedToolCalls(result, pairedResultIds);
  cleaned = stripUnpairedToolResults(cleaned, pairedCallIds);
  cleaned = ensureTrailingUserMessage(cleaned);

  logger.info('compaction:triggered', {
    tier: 2,
    reason: 'budget exceeded',
    turnsSnipped,
    keepHeadTurns: opts.keepHeadTurns,
    keepTailTurns: opts.keepTailTurns,
  });

  return {
    messages: cleaned,
    applied: true,
    turnsSnipped,
  };
}
