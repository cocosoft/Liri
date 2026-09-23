/**
 * SnipEngine — Tier 2 轮次裁剪（Phase 3）
 * 对标 PilotDeck SnipEngine
 *
 * 裁剪中间轮次，保留头部 N 轮 + 尾部 N 轮
 * 零 LLM 调用
 */
import type { ChatMessage } from '@modules/ai';
import {
  ensureTrailingUserMessage,
  stripUnpairedToolCalls,
  stripUnpairedToolResults,
  // D1（2026-09-21）：按工具轮裁剪会**跨段切断配对**，需要请求侧的严格收敛
  sanitizeToolCallPairs,
} from './toolPairIntegrity';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('context:compaction:snip');

export interface SnipEngineOptions {
  keepHeadTurns?: number;
  keepTailTurns?: number;
  enabled?: boolean;
  /**
   * D1（2026-09-21）：agentic 兜底 —— 用户轮次不足时改按**工具轮**裁剪，
   * 保留首/尾各 N 个工具轮。
   */
  keepHeadToolRounds?: number;
  keepTailToolRounds?: number;
}

export interface SnipResult {
  messages: ChatMessage[];
  applied: boolean;
  turnsSnipped: number;
  /** D1：本次按工具轮裁掉的轮数（未走该路径时为 0） */
  toolRoundsSnipped?: number;
}

const DEFAULT_OPTIONS: Required<SnipEngineOptions> = {
  keepHeadTurns: 2,
  keepTailTurns: 4,
  enabled: true,
  // D1：首 2 轮（任务的"开场探查"）+ 尾 8 轮（当前进展/最近结论）——尾部权重更大，
  // 因为 agentic 任务的**当前状态**几乎总在尾部（真机 75 工具轮的会话即如此）。
  keepHeadToolRounds: 2,
  keepTailToolRounds: 8,
};

/** 单条消息最大字符数：超过则截断（防单条巨大 tool_result/system 消息撑爆窗口，轮次裁剪无效场景） */
const MAX_MESSAGE_CHARS = 16_000;
/** 截断后头部保留比例（剩余保留在尾部，中间省略标记） */
const TRUNCATE_KEEP_HEAD_RATIO = 0.6;

/**
 * P2-4（对标 deepseek-harness tool-result-pruner）：Unicode 码点安全头尾截断。
 * JS `slice` 按 UTF-16 单元切分，会切开 surrogate pair（emoji/生僻字变乱码）；
 * 本函数按 Unicode code point 切分，保留边界不拆代理对。
 * @param content 原始内容
 * @returns 截断后内容（未超长时返回原串）
 */
function truncateUnicodeSafe(content: string): string {
  const chars = Array.from(content); // 按码点（code point）切分
  if (chars.length <= MAX_MESSAGE_CHARS) return content;
  const keepHead = Math.floor(MAX_MESSAGE_CHARS * TRUNCATE_KEEP_HEAD_RATIO);
  const keepTail = MAX_MESSAGE_CHARS - keepHead;
  const head = chars.slice(0, keepHead).join('');
  const tail = chars.slice(chars.length - keepTail).join('');
  return (
    head +
    `\n\n[... 内容过长已截断（原 ${chars.length} 字符），保留头尾 ...]\n\n` +
    tail
  );
}

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
    if (!content) return msg;
    const truncated = truncateUnicodeSafe(content);
    // 未超长 → 原样返回
    if (truncated === content) return msg;
    // BUG-FIX：当前用户输入不截断（LLM 需看完整提问，且避免写回会话时原始内容丢失）
    if (idx === lastUserIdx) return msg;
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

/* ===================================================================
 * D1（2026-09-21）：按**工具轮**裁剪 —— agentic 会话的零成本降 token 通道
 *
 * 问题：`groupByTurns` 以 **user 消息**切轮，默认 `2 + 4 = 6` 轮才开始动刀；
 * 而 agentic 会话的体量由**工具轮**贡献（真机实证：226 消息 / 75 工具轮 /
 * user 轮次极少）⇒ 门禁恒成立 ⇒ `applied:false` ⇒ 每次压缩都升级 Tier3（一次 LLM 调用），
 * 连下方"超长消息截断"也被同一道门禁挡在外面。
 *
 * 本节提供兜底：轮次不足时改按工具轮裁首/尾、丢中段，合成 `<snip-boundary>` 占位。
 * 仅在"原实现直接放弃"的分支内生效 ⇒ 既有 user 轮裁剪行为完全不变。
 * =================================================================== */

/** 工具轮起点 = 带 `tool_calls` 的 assistant 消息（一次 LLM 决策 + 其工具结果） */
function isToolRoundStart(msg: ChatMessage): boolean {
  const toolCalls = (msg as unknown as Record<string, unknown>).tool_calls as
    | Array<{ id?: string }>
    | undefined;
  return msg.role === 'assistant' && (toolCalls?.length ?? 0) > 0;
}

/**
 * 按工具轮切段：`[0]` = **前导段**（system + 当前 user 指令 + 首个工具轮之前的消息，不裁），
 * `[1..]` = 各工具轮（起点为带 tool_calls 的 assistant，延续到下一个起点之前）。
 */
function splitByToolRounds(messages: ChatMessage[]): ChatMessage[][] {
  const segments: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  for (const msg of messages) {
    if (isToolRoundStart(msg)) {
      segments.push(current); // 前导段 / 上一轮收口
      current = [msg];
      continue;
    }
    current.push(msg);
  }
  segments.push(current); // 末段（含无工具轮时的"全量前导段"）
  return segments;
}

/** 工具轮裁剪的边界占位（含"可重查"指引，降低信息损失） */
function createToolRoundBoundary(
  roundsSnipped: number,
  opts: Required<SnipEngineOptions>
): string {
  return `<snip-boundary>
  为控制上下文体积，已裁剪中间的 ${roundsSnipped} 个工具调用轮次（保留最早 ${opts.keepHeadToolRounds} 轮 + 最近 ${opts.keepTailToolRounds} 轮）。
  被裁剪部分是已完成的工具调用与其结果；若当前任务需要其中的内容，请重新读取相关文件或重新检索，不要凭记忆臆测。
</snip-boundary>`;
}

/**
 * D1：按工具轮裁剪。工具轮数不足（≤ 首+尾）⇒ `applied:false`（不臆造、不制造"裁了但没省"）。
 */
function snipByToolRounds(
  messages: ChatMessage[],
  opts: Required<SnipEngineOptions>
): SnipResult {
  const segments = splitByToolRounds(messages);
  const rounds = segments.length - 1;
  if (rounds <= opts.keepHeadToolRounds + opts.keepTailToolRounds) {
    return { messages, applied: false, turnsSnipped: 0, toolRoundsSnipped: 0 };
  }

  const headEnd = 1 + opts.keepHeadToolRounds; // segments[0] 为前导段
  const tailStart = Math.max(
    headEnd,
    segments.length - opts.keepTailToolRounds
  );
  const snipped = rounds - opts.keepHeadToolRounds - opts.keepTailToolRounds;

  let result: ChatMessage[] = [
    ...segments.slice(0, headEnd).flat(),
    {
      role: 'user',
      content: createToolRoundBoundary(snipped, opts),
    } as unknown as ChatMessage,
    ...segments.slice(tailStart).flat(),
  ];
  // 跨段裁剪会**切断配对**：尾部首条可能是被裁掉那条 assistant 的 tool 结果
  // （孤立 tool 结果同样被上游 400）⇒ 用请求侧严格收敛兜底（与 R6 同一函数）。
  result = sanitizeToolCallPairs(result);
  result = truncateOverlongMessages(result);
  result = ensureTrailingUserMessage(result);

  logger.info('compaction:triggered', {
    tier: 2,
    reason: 'agentic_tool_rounds',
    toolRoundsSnipped: snipped,
    keepHeadToolRounds: opts.keepHeadToolRounds,
    keepTailToolRounds: opts.keepTailToolRounds,
    beforeCount: messages.length,
    afterCount: result.length,
  });

  return {
    messages: result,
    applied: true,
    turnsSnipped: 0,
    toolRoundsSnipped: snipped,
  };
}

/**
 * Tier 2 轮次裁剪：保留头部 + 尾部轮次，裁剪中间
 *
 * D1（2026-09-21）两处调整：
 *  ① **超长截断提前到门禁之前** —— 它零 LLM、与轮次裁剪无关，原实现在门禁之后，
 *    被 `turns.length <= 6` 一起挡掉（"单条巨大 tool_result"场景永不生效）；
 *  ② 门禁失败时**不再直接放弃**，改走 `snipByToolRounds`（agentic 兜底）。
 */
export function snipMessages(
  messages: ChatMessage[],
  options: SnipEngineOptions = {}
): SnipResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!opts.enabled || messages.length === 0) {
    return { messages, applied: false, turnsSnipped: 0 };
  }

  // ① 超长消息截断（门禁之前）：逐条头尾截断，纯同步零 LLM。
  // `applied` 语义 = "本次对本数组产生了改动" ⇒ 截断生效时也如实上报（调用方据此决定
  // 是否写回会话，见 compactSessionInBackground 的 `if (!result.applied) return false`）。
  const prepared = truncateOverlongMessages(messages);
  const truncatedChanged = prepared.some((msg, idx) => msg !== messages[idx]);

  const turns = groupByTurns(prepared);
  if (turns.length <= opts.keepHeadTurns + opts.keepTailTurns) {
    // ② agentic 兜底
    const byToolRounds = snipByToolRounds(prepared, opts);
    if (byToolRounds.applied) return byToolRounds;
    return {
      messages: prepared,
      applied: truncatedChanged,
      turnsSnipped: 0,
      toolRoundsSnipped: 0,
    };
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
  for (let i = 0; i < prepared.length; i++) {
    if (keepIndices.has(i)) {
      result.push(prepared[i]);
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
  // 项2 的超长截断已在进入本路径前统一做过（`prepared`）——此处不再重复扫描
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
