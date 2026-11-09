/**
 * 统一 Token 估算服务
 *
 * 替代分散在多个模块中的 Token 估算逻辑：
 * - services/tokenManagement/TokenCounter.ts (roughTokenCountEstimation)
 * - services/tokenManagement/TokenEstimator.ts (model-specific charsPerToken)
 * - core/tokenBudget/TokenBudgetController.ts (Rust native → fallback)
 * - query/TokenBudget.ts (heuristicEstimate)
 *
 * 三级精度路径：
 *   1. tiktoken (o200k_base BPE) — 真值分词，对标 PilotDeck
 *   2. CJK 感知算法 — CJK×1.5 + 英文 chars/4
 *   3. 纯 chars/4 — 终极 fallback
 *
 * CJK 感知算法与 Rust native estimate_message_tokens() 保持一致。
 */
import type { ChatMessage } from '../models/types';
import { getTiktokenCount } from './TiktokenEstimator';
import { getCachedTiktokenEncoder } from './TiktokenEstimator';
import { getLogger } from '@openliri/infra/monitoring';
import { TOOL_RESULT_MAX_LENGTH } from '@openliri/infra/utils/toolResultLimits';

// Bun 全局在本仓的类型声明是「按需最小子集」（见 `src/ink/ink/global.d.ts`，不含 `hash`）。
// 此处按需补充本模块用到的 `Bun.hash`，与 `src/buddy/companion.ts` 同法（模块作用域，不污染全局）。
declare const Bun: { hash: (s: string) => bigint };

const logger = getLogger('ai:tokenizer');

const CJK_REGEX =
  /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/gu;

/** 每消息角色开销（tokens） */
const ROLE_OVERHEAD: Record<string, number> = {
  system: 4,
  user: 5,
  assistant: 5,
};

/** 每消息最小包装开销 */
const PER_MESSAGE_OVERHEAD = 4;

/**
 * R3（2026-09-16）：单消息 token 估算的按对象身份 FIFO 缓存。
 * 对话历史按轮**追加**（同一条消息对象跨轮复用），缓存每条消息对象的估算值后，
 * 后续轮次仅对新增消息真正 encode，不变历史直接命中——消除"每轮全量 re-tokenize"
 * （实测 170K tokens 每轮重算导致事件循环 lag 1.2-1.5s）。
 * 以对象身份（而非内容串 hash）为 key，避免对大段内容再做等价的散列开销。
 * 容量有上限（FIFO，超限淘汰一半），防长会话缓存泄漏。
 */
const PER_MESSAGE_TOKEN_CACHE = new Map<object, number>();
const PER_MESSAGE_TOKEN_CACHE_ORDER: object[] = [];
/**
 * D-232（2026-10-02）：上限由 **2000 提高到 20000**。
 * 原值低于大会话的消息数（实测 2200 条）⇒ 每轮都触发"超限淘汰一半"，
 * 而淘汰的恰是**下轮最需要的前半段**（列表按时间顺序遍历）⇒ **必然抖动**，
 * 缓存形同失效。条目仅"对象引用 + 数值"，2 万条内存开销可忽略（≈1MB，对比实测 RSS 3.4GB）。
 */
const PER_MESSAGE_TOKEN_CACHE_LIMIT = 20000;

/** 查缓存——命中返回数值，未命中返回 undefined */
function cachedMessageTokens(msg: object): number | undefined {
  return PER_MESSAGE_TOKEN_CACHE.get(msg);
}

/** 写缓存（FIFO 淘汰：超上限时淘汰最早的一半，保留近期工作集） */
function storeMessageTokens(msg: object, tokens: number): void {
  if (PER_MESSAGE_TOKEN_CACHE.has(msg)) return;
  PER_MESSAGE_TOKEN_CACHE.set(msg, tokens);
  PER_MESSAGE_TOKEN_CACHE_ORDER.push(msg);
  if (PER_MESSAGE_TOKEN_CACHE_ORDER.length > PER_MESSAGE_TOKEN_CACHE_LIMIT) {
    const toEvict = Math.floor(PER_MESSAGE_TOKEN_CACHE_ORDER.length / 2);
    for (let i = 0; i < toEvict; i++) {
      const key = PER_MESSAGE_TOKEN_CACHE_ORDER.shift();
      if (key !== undefined) PER_MESSAGE_TOKEN_CACHE.delete(key);
    }
  }
}

/**
 * 2026-11-09：**内容摘要缓存（第二层，跨对象重建）**。
 *
 * 对象身份缓存（R3）只在"同一条消息对象跨轮复用"时有效；但请求侧
 * `buildApiMessagesForStream` 每轮都按 `{ role, content }` **重建** apiMessages 对象
 * ⇒ 流式主链路上身份缓存必然全 miss ⇒ 每轮对整窗历史重做 BPE。
 * 真机 CPU profile（event-loop block，lag 3.5s）：`estimateMessagesTokens → encode →
 * bytePairMerge / join` 自耗时合计 ≈55%（≈1.9s），全部来自"内容没变、对象是新的"。
 *
 * 以**内容摘要**为键（只存内容 tokens，不含角色开销）⇒ 重建对象也能命中，成本回到
 * "仅本轮新增消息"。只持有 64 位摘要、不持有原文字符串，避免大会话内存泄漏。
 */
const CONTENT_TOKEN_CACHE = new Map<number, number>();
// 上限复用 `PER_MESSAGE_TOKEN_CACHE_LIMIT`（条目仅"摘要 + 数值"，量级一致）
const CONTENT_TOKEN_CACHE_ORDER: number[] = [];

/** 内容摘要：优先 Bun 原生 hash；非 Bun 运行时不启用该层（退回身份缓存） */
function contentDigest(text: string): number | undefined {
  if (typeof Bun === 'undefined' || typeof Bun.hash !== 'function')
    return undefined;
  return Number(Bun.hash(text));
}

function storeContentTokens(digest: number, tokens: number): void {
  if (CONTENT_TOKEN_CACHE.has(digest)) return;
  CONTENT_TOKEN_CACHE.set(digest, tokens);
  CONTENT_TOKEN_CACHE_ORDER.push(digest);
  if (CONTENT_TOKEN_CACHE_ORDER.length > PER_MESSAGE_TOKEN_CACHE_LIMIT) {
    const toEvict = Math.floor(CONTENT_TOKEN_CACHE_ORDER.length / 2);
    for (let i = 0; i < toEvict; i++) {
      const key = CONTENT_TOKEN_CACHE_ORDER.shift();
      if (key !== undefined) CONTENT_TOKEN_CACHE.delete(key);
    }
  }
}

/** 单段内容的 tokens（内容摘要缓存 → tiktoken BPE → CJK 启发式） */
function contentTokens(
  text: string,
  encoder: ReturnType<typeof getCachedTiktokenEncoder>
): number {
  const digest = contentDigest(text);
  if (digest !== undefined) {
    const cached = CONTENT_TOKEN_CACHE.get(digest);
    if (cached !== undefined) return cached;
  }
  let tokens: number;
  if (encoder) {
    try {
      tokens = encoder.encode(text).length;
    } catch {
      // 编码失败时回退到启发式
      tokens = estimateTokens(text);
    }
  } else {
    tokens = estimateTokens(text);
  }
  if (digest !== undefined) storeContentTokens(digest, tokens);
  return tokens;
}

/**
 * D-233（2026-10-02）：**单条消息的 token 计算（缓存优先）** —— 各估算路径共用，避免逻辑分叉。
 * 命中缓存直接返回；未命中则 tiktoken BPE → CJK 启发式，并写回缓存。
 * 缓存值口径 = 角色开销 + 内容 tokens（与同步版一致）。
 */
function tokenOfMessage(
  msg: { role?: string; content?: string | unknown },
  encoder: ReturnType<typeof getCachedTiktokenEncoder>
): number {
  const cacheable = typeof msg === 'object' && msg !== null;
  if (cacheable) {
    const cached = cachedMessageTokens(msg as object);
    if (cached !== undefined) return cached;
  }
  const overhead = ROLE_OVERHEAD[msg.role ?? 'user'] ?? PER_MESSAGE_OVERHEAD;
  let per = overhead;
  if (typeof msg.content === 'string') {
    // 戊（D-234）：与请求侧同口径（工具结果超长则按上限取样），避免对 14MB 原文做 BPE
    per += contentTokens(contentForEstimate(msg, msg.content), encoder);
  } else if (msg.content) {
    per += estimateTokens(JSON.stringify(msg.content));
  }
  if (cacheable) storeMessageTokens(msg as object, per);
  return per;
}

/**
 * 戊（2026-10-02 / D-234）：**估算必须与「实际发送内容」同口径**。
 *
 * 请求侧对工具结果调用 `truncateToolResult()`（上限 `TOOL_RESULT_MAX_LENGTH`，保留头 500 字符
 * + 尾 `上限-500` 字符）；但历史里持久化的是**未截断原文**（实测单条 `tool_result` ≈14MB，
 * 会话 30.43MB / 2380 行）。若估算按原文计入 ⇒ 口径不一致：成本被无意义放大
 * （实测单次 pre-eval 阻塞 70.4s、水位虚高至 7559%）。
 * ⇒ 对「工具结果且超长」的消息按同一上限**取样后**再编码（切片极廉价，避免对 14MB 做 BPE）。
 * **非工具结果消息不受影响**（保持原口径）。
 */
function contentForEstimate(
  msg: { role?: string; content?: string | unknown },
  content: string
): string {
  if (content.length <= TOOL_RESULT_MAX_LENGTH) return content;
  const m = msg as { type?: string; role?: string };
  const isToolResult = m.type === 'tool_result' || m.role === 'tool';
  if (!isToolResult) return content;
  const headLen = 500;
  const tailLen = TOOL_RESULT_MAX_LENGTH - headLen;
  return content.slice(0, headLen) + content.slice(content.length - tailLen);
}

/**
 * CJK 感知 Token 估算（与 Rust native 算法一致）
 *
 * - CJK 字符占比 > 30% → CJK*1.5 + 非CJK*0.25
 * - 否则 → word_count*1.3 + text_len*0.05
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  const cjkMatches = text.match(CJK_REGEX);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const totalChars = text.length;

  if (cjkCount === 0) {
    return Math.ceil(totalChars / 4);
  }

  const cjkRatio = cjkCount / totalChars;
  if (cjkRatio > 0.3) {
    // CJK 主导：CJK 字符 ≈ 2.0 token, 非 CJK ≈ 0.35 token
    // P1 修复（2026-08-14 排查）：deepseek 等中文模型实测低估 2.5-3.6 倍
    // （estimated 4321 vs actual 15585），BPE 真实中文 1 字 ≈ 1.5-2 token，
    // 原系数 1.5/0.25 偏保守。上调后减少对校准因子（重启从 1.2 重学）的依赖。
    const words = text.split(/\s+/).filter(Boolean);
    const nonCjk = totalChars - cjkCount;
    return (
      Math.ceil(cjkCount * 2.0 + nonCjk * 0.35) + Math.min(words.length, 5)
    );
  }

  // 英文主导：约 4 字符/token
  const words = text.split(/\s+/).filter(Boolean);
  return Math.ceil(words.length * 1.3 + totalChars * 0.05);
}

/**
 * 估算单条消息的 token 数（含角色开销）
 */
export function estimateMessageTokens(message: {
  role?: string;
  content?: string | unknown;
}): number {
  let tokens = 0;

  if (typeof message.content === 'string') {
    tokens += estimateTokens(message.content);
  } else if (message.content) {
    tokens += estimateTokens(JSON.stringify(message.content));
  }

  const overhead =
    ROLE_OVERHEAD[message.role ?? 'user'] ?? PER_MESSAGE_OVERHEAD;
  tokens += overhead;

  return Math.ceil(tokens);
}

/**
 * 估算消息列表的 token 数
 * 三级精度：tiktoken BPE（缓存）→ CJK 启发式 → chars/4
 */
export function estimateMessagesTokens(
  messages: readonly { role?: string; content?: string | unknown }[]
): number {
  if (!messages || messages.length === 0) return 0;

  // 优先使用 tiktoken BPE 精确分词（若编码器已加载）
  const encoder = getCachedTiktokenEncoder();
  // 2026-11-09：收敛到 `tokenOfMessage`（CS01 单一实现）——此前本函数重复了一份
  // "身份缓存 → BPE → 启发式"的逻辑，且漏掉了内容摘要缓存 ⇒ 重建对象时全量重编码。
  let total = 0;
  for (const msg of messages) total += tokenOfMessage(msg, encoder);
  return Math.ceil(total);
}

/**
 * 让出事件循环（macrotask），避免长循环同步阻塞其他 I/O（SSE 心跳 / HTTP 请求）。
 * 2026-08-19 根因①修复：发送前对数百条消息的同步估算/构建曾实测阻塞事件循环 49s，
 * 期间心跳与请求全部卡死，前端把"后端正在处理"误判为"流式响应超时"。
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * 协作式消息列表 token 估算（异步，分批让出事件循环）
 *
 * 与 estimateMessagesTokens 口径完全一致（tiktoken 缓存优先 → CJK 启发式），
 * 但每处理 batchSize 条消息就 await 一次让出事件循环。
 * 用于发送路径等大列表场景（数百条消息），避免同步估算阻塞事件循环。
 */
export async function estimateMessagesTokensCooperative(
  messages: readonly { role?: string; content?: string | unknown }[],
  batchSize = 25
): Promise<number> {
  if (!messages || messages.length === 0) return 0;

  // 优先使用 tiktoken BPE 精确分词（若编码器已加载）
  const encoder = getCachedTiktokenEncoder();
  let total = 0;
  const totalStart = Date.now();
  let batchStart = totalStart;
  for (let i = 0; i < messages.length; i++) {
    // D-232/D-233（2026-10-02）：统一走 `tokenOfMessage`（**缓存优先**）。
    // 此前本路径未查缓存（与函数头注"tiktoken 缓存优先"不符）⇒ 每轮对全部消息重新 encode：
    // 实测 2200 条 / 967 万 tokens 的会话，单次 pre-eval 阻塞事件循环 70.4s
    // （日志 `compaction:pre_eval_done` elapsedMs=70388，同期事件循环滞后 57437ms）。
    total += tokenOfMessage(messages[i], encoder);
    if ((i + 1) % batchSize === 0) {
      // 2026-08-19 根因①修复监控：记录每批估算耗时，验证让出事件循环的有效性
      logger.debug('estimate:cooperative_batch_done', {
        batch: Math.floor((i + 1) / batchSize),
        processed: i + 1,
        batchDurationMs: Date.now() - batchStart,
        totalDurationMs: Date.now() - totalStart,
      });
      batchStart = Date.now();
      await yieldToEventLoop();
    }
  }
  // 2026-08-19 根因①修复监控：总耗时（含所有让出等待）
  logger.debug('estimate:cooperative_total_done', {
    totalMessages: messages.length,
    estimatedTokens: total,
    totalDurationMs: Date.now() - totalStart,
  });
  return Math.ceil(total);
}

/**
 * D-233（2026-10-02）：**自尾部累计的限额估算（决策用下界）**。
 *
 * 动机：压缩决策只需回答「是否已达阈值」。但会话可能含**巨型历史消息**
 * （实测单条 `tool_result` ≈14MB；会话 30.43MB / 2380 行），全量估算要 BPE 编码
 * 千万级 token ⇒ 阻塞事件循环 70s；而这类"早已超窗"的旧历史对决策的唯一作用就是"已超限"。
 *
 * 行为：自**最新**消息往回累计；一旦 ≥ `capTokens` 立即返回 `{ capped: true }`
 * （此时 `tokens` 仅为**下界**）；否则扫完返回精确总和（与
 * `estimateMessagesTokensCooperative` **同口径、同缓存**）。
 *
 * 判据正确性：调用方传 `capTokens = 上下文窗口`，而决策侧 `factor ≥ 1.2`
 * ⇒ `capped=true` 时必有 `ratio = factor × (tokens + output) / limit ≥ 1.2 > compact 阈值`
 * ⇒ 结论必为 `trigger`，与全量估算一致（单调性：和只会随包含更多消息而增大）。
 */
export async function estimateMessagesTokensCooperativeFromTail(
  messages: readonly { role?: string; content?: string | unknown }[],
  capTokens: number,
  batchSize = 25
): Promise<{ tokens: number; capped: boolean }> {
  if (!messages || messages.length === 0) return { tokens: 0, capped: false };
  const encoder = getCachedTiktokenEncoder();
  const totalStart = Date.now();
  let total = 0;
  let processed = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    total += tokenOfMessage(messages[i], encoder);
    processed++;
    if (capTokens > 0 && total >= capTokens) {
      logger.debug('estimate:cooperative_tail_capped', {
        processed,
        totalMessages: messages.length,
        cappedTokens: total,
        capTokens,
        totalDurationMs: Date.now() - totalStart,
      });
      return { tokens: total, capped: true };
    }
    if (processed % batchSize === 0) await yieldToEventLoop();
  }
  logger.debug('estimate:cooperative_total_done', {
    totalMessages: messages.length,
    estimatedTokens: total,
    totalDurationMs: Date.now() - totalStart,
    fromTail: true,
  });
  return { tokens: total, capped: false };
}

/**
 * 估算图片 token 数（固定值）
 */
export const IMAGE_TOKEN_ESTIMATE = 1600;

/**
 * API 优先 + 估算 fallback：如果 API 返回了 usage，优先使用 API 数据
 * 对标 cc_code 的 tokenCountWithEstimation() 模式
 */
export function tokenCountWithEstimation(
  messages: readonly {
    role?: string;
    content?: string | unknown;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  }[],
  apiReportedTokens?: number | null
): number {
  if (apiReportedTokens != null && apiReportedTokens > 0) {
    return apiReportedTokens;
  }

  // 从最后一条有 usage 的 assistant message 获取 API 数据
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.usage?.totalTokens && msg.usage.totalTokens > 0) {
      return msg.usage.totalTokens;
    }
  }

  return estimateMessagesTokens(messages);
}

/**
 * 使用 tiktoken BPE 精确计算 token 数（异步，对标 PilotDeck）
 * tiktoken 不可用时自动回退到 CJK 感知估算
 */
export async function estimateTokensPrecise(text: string): Promise<number> {
  const tiktokenResult = await getTiktokenCount(text);
  if (tiktokenResult != null) return tiktokenResult;
  return estimateTokens(text);
}

/**
 * 精确估算消息列表 token 数（异步，tiktoken 优先）
 */
export async function estimateMessagesTokensPrecise(
  messages: readonly { role?: string; content?: string | unknown }[]
): Promise<number> {
  // 如果 tiktoken 可用，对所有消息内容做精确计算
  // 2026-11-04（运行态排查 C2）：改走 `getCachedTokenCount` —— 探针实测 BPE 分词
  // （`bytePairMerge`）占主线程 self time 的 25–34%，而本函数在**每次请求**都会把
  // 整段历史消息重新编码一遍（内容不变）⇒ 缓存命中后单次 59KB 文本从 24ms 降到 0.09ms。
  const enc = await import('./TiktokenEstimator')
    .then((m) => ({
      getTiktokenEncoder: m.getTiktokenEncoder,
      getCachedTokenCount: m.getCachedTokenCount,
    }))
    .catch(() => null);
  if (enc) {
    const encoder = await enc.getTiktokenEncoder();
    if (encoder) {
      let total = 0;
      for (const msg of messages) {
        const overhead =
          ROLE_OVERHEAD[msg.role ?? 'user'] ?? PER_MESSAGE_OVERHEAD;
        total += overhead;
        if (typeof msg.content === 'string') {
          const cached = enc.getCachedTokenCount(msg.content);
          total += cached ?? estimateTokens(msg.content);
        } else if (msg.content) {
          total += estimateTokens(JSON.stringify(msg.content));
        }
      }
      return Math.ceil(total);
    }
  }

  return estimateMessagesTokens(messages);
}
