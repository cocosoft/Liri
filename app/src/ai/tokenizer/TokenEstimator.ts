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
import { getLogger } from '@modules/monitoring';

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
  if (encoder) {
    let total = 0;
    for (const msg of messages) {
      const overhead =
        ROLE_OVERHEAD[msg.role ?? 'user'] ?? PER_MESSAGE_OVERHEAD;
      total += overhead;
      if (typeof msg.content === 'string') {
        try {
          const result = encoder.encode(msg.content);
          total += Array.isArray(result) ? result.length : result.length;
        } catch {
          // 编码失败时回退到启发式
          total += estimateTokens(msg.content);
        }
      } else if (msg.content) {
        total += estimateTokens(JSON.stringify(msg.content));
      }
    }
    return Math.ceil(total);
  }

  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
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
    const msg = messages[i];
    const overhead = ROLE_OVERHEAD[msg.role ?? 'user'] ?? PER_MESSAGE_OVERHEAD;
    total += overhead;
    if (typeof msg.content === 'string') {
      if (encoder) {
        try {
          const result = encoder.encode(msg.content);
          total += Array.isArray(result) ? result.length : result.length;
        } catch {
          // 编码失败时回退到启发式
          total += estimateTokens(msg.content);
        }
      } else {
        total += estimateTokens(msg.content);
      }
    } else if (msg.content) {
      total += estimateTokens(JSON.stringify(msg.content));
    }
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
  const encoder = await import('./TiktokenEstimator')
    .then((m) => m.getTiktokenEncoder())
    .catch(() => null);
  if (encoder) {
    let total = 0;
    for (const msg of messages) {
      const overhead =
        ROLE_OVERHEAD[msg.role ?? 'user'] ?? PER_MESSAGE_OVERHEAD;
      total += overhead;
      if (typeof msg.content === 'string') {
        try {
          const result = encoder.encode(msg.content);
          total += Array.isArray(result) ? result.length : result.length;
        } catch {
          // @ignore-catch: fallback to estimate
          total += estimateTokens(msg.content);
        }
      } else if (msg.content) {
        total += estimateTokens(JSON.stringify(msg.content));
      }
    }
    return Math.ceil(total);
  }

  return estimateMessagesTokens(messages);
}
