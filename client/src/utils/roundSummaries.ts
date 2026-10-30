/**
 * 轮次摘要**唯一实现**（2026-10-30，一致性核查 §9.4 B3）。
 *
 * 为什么抽出来（CS01 单一实现）：左右两侧都要"每轮一行摘要" ——
 * - 右侧「上下文 → 消息摘要」面板（`ChatInspector/ContextTab.tsx`）；
 * - 左侧「轮次导航」（`ChatArea/RoundNavigator.tsx`，B1 起常显摘要）。
 *
 * 两边原先各算一份（左侧只取 `slice(0, 20)` 进原生 `title`、右侧另写 60 字摘要），
 * 口径不一致（截断长度、换行处理、兜底文案）。本模块是唯一算法，两侧只消费结果。
 */

import type { TFunction } from "i18next";
import type { Message } from "../types";

/** 摘要最多覆盖的轮数（避免大会话卡主线程） */
export const ROUND_SUMMARY_MAX_ROUNDS = 50;

/** 单条摘要最大字符数（用户问题 / AI 回复同一口径） */
export const ROUND_SUMMARY_MAX_CHARS = 60;

export interface RoundSummary {
  /** 1-based 轮号（相对已传入的 messages，不是会话绝对轮号） */
  roundIndex: number;
  /** 用户问题摘要（换行转空格、截断至上限、空则兜底文案） */
  userMsg: string;
  /** 该轮用户消息 id（点击跳转用） */
  userMsgId: string;
  /** AI 回复摘要（同上；尚未回复 ⇒ 空串） */
  assistantMsg: string;
  timestamp: number;
}

/** 文本归一：换行转空格 + 截断（超长补省略号）；空文本返回空串（由调用方决定兜底） */
export function summarizeRoundText(
  text: string | undefined,
  maxChars: number = ROUND_SUMMARY_MAX_CHARS,
): string {
  const normalized = (text ?? "").replace(/\s*\n\s*/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars)}…`
    : normalized;
}

/**
 * 把消息流按"user 提问 + 随后的 assistant 回复"合并为轮次摘要。
 *
 * 语义锁定：只处理**最近** `maxRounds` 轮（从尾部往前取双倍消息，每轮约 2 条）；
 * 一条 user 消息开启新一轮，其后的 assistant 文本块（`blocks` 里的 text 优先，
 * 否则 `content`）填进该轮的 `assistantMsg`。
 */
export function buildRoundSummaries(
  messages: Message[],
  t: TFunction,
  options: { maxRounds?: number; maxChars?: number } = {},
): RoundSummary[] {
  const maxRounds = options.maxRounds ?? ROUND_SUMMARY_MAX_ROUNDS;
  const maxChars = options.maxChars ?? ROUND_SUMMARY_MAX_CHARS;
  const rounds: RoundSummary[] = [];
  let current: Omit<RoundSummary, "roundIndex"> | null = null;

  // 从尾部往前取最近的消息，构建轮次摘要
  const recentMessages = messages.slice(-maxRounds * 2); // 每轮约 2 条(user+assistant)
  for (const msg of recentMessages) {
    const content = msg.content || "";
    if (msg.role === "user") {
      if (current) {
        rounds.push({ ...current, roundIndex: rounds.length + 1 });
      }
      current = {
        userMsg:
          summarizeRoundText(content, maxChars) ||
          t("chatInspector.userMessageFallback"),
        userMsgId: msg.id,
        assistantMsg: "",
        timestamp: msg.timestamp,
      };
    } else if (msg.role === "assistant" && current) {
      const textBlocks =
        msg.blocks
          ?.filter((b) => b.type === "text")
          .map((b) => b.content)
          .join(" ") || content;
      current.assistantMsg =
        summarizeRoundText(textBlocks, maxChars) ||
        t("chatInspector.aiReplyFallback");
    }
  }

  if (current) {
    rounds.push({ ...current, roundIndex: rounds.length + 1 });
  }

  return rounds;
}
