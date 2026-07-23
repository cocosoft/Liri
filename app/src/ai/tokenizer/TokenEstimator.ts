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
    // CJK 主导：CJK 字符 ≈ 1.5 token, 非 CJK ≈ 0.25 token
    const words = text.split(/\s+/).filter(Boolean);
    const nonCjk = totalChars - cjkCount;
    return (
      Math.ceil(cjkCount * 1.5 + nonCjk * 0.25) + Math.min(words.length, 5)
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
 */
export function estimateMessagesTokens(
  messages: readonly { role?: string; content?: string | unknown }[]
): number {
  if (!messages || messages.length === 0) return 0;
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
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
  const encoder = await import('./TiktokenEstimator').then((m) =>
    m.getTiktokenEncoder()
  );
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
