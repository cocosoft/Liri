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
import { getLogger } from '@modules/monitoring';
const logger = getLogger('context:compaction:snip');

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

/** 单条消息最大字符数：超过则截断（防单条巨大 tool_result/system 消息撑爆窗口，轮次裁剪无效场景） */
const MAX_MESSAGE_CHARS = 16_000;
/** 截断后头部保留比例（剩余保留在尾部，中间省略标记） */
const TRUNCATE_KEEP_HEAD_RATIO = 0.6;

/**
 * 单条超长消息截断（项2 落地，会话排查 2026-08-13）：
 * SnipEngine 按轮次裁剪，若"单条超长消息"（如巨大 tool_result、超长 system prompt）
 * 本身就是窗口膨胀主因，轮次裁剪无法降体积（只有一轮）→ Tier2 无效 → 依赖 Tier3。
 * 此处对超长消息内容做头尾截断，纯同步零 LLM，与 C5 截断兜底互补。
 *
 * BUG-FIX（2026-08-19 per-message 截断）：**跳过当前用户输入**（最后一条 user 消息）。
 * 原实现对全部消息截断，会把用户最新提问的中间部分裁掉：
 * ① 发送路径 compact(apiMessages) 中 LLM 看不到提问完整内容（关键上下文丢失）；
 * ② 后台 compactSessionInBackground 把截断结果写回 session.messages，原始提问
 *    内容被截断覆盖。
 * 截断仅适用于历史消息（tool_result / system / 旧轮次），与设计意图
 * （"防单条巨大 tool_result/system 消息撑爆窗口"）一致。
 */
function truncateOverlongMessages(messages: ChatMessage[]): ChatMessage[] {
  // 定位最后一条 user 消息索引（当前用户输入，禁止截断）
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  return messages.map((msg, idx) => {
    const content = typeof msg.content === 'string' ? msg.content : null;
    if (!content || content.length <= MAX_MESSAGE_CHARS) return msg;
    // BUG-FIX：当前用户输入不截断（LLM 需看完整提问，且避免写回会话时原始内容丢失）
    if (idx === lastUserIdx) return msg;
    const keepHead = Math.floor(MAX_MESSAGE_CHARS * TRUNCATE_KEEP_HEAD_RATIO);
    const keepTail = MAX_MESSAGE_CHARS - keepHead;
    const truncated =
      content.slice(0, keepHead) +
      `\n\n[... 内容过长已截断（原 ${content.length} 字符），保留头尾 ...]\n\n` +
      content.slice(content.length - keepTail);
    return { ...msg, content: truncated } as ChatMessage;
  });
}

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
  // 项2：单条超长消息截断（轮次裁剪后的补充，防单条巨大消息撑爆窗口）
  cleaned = truncateOverlongMessages(cleaned);
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
