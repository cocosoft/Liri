// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-05b（2026-10-17）：渠道交互提问的“下一条消息即答案”注册表（进程内）。
 *
 * 设计边界（方案 §8.3）：
 * - 仅内存、按渠道+发送者+会话隔离；TTL 默认 5 分钟；
 * - 只在 `CHANNEL_QUESTION_ANSWER` 开启且渠道声明 interactive 时启用；
 * - 命中后由 `messageRouter` 调 `resolveInteraction`，**不创建新回合**。
 */
export interface PendingChannelQuestion {
  questionId: string;
  /** 提问所属会话（resolveInteraction 需要） */
  sessionId: string;
  questionType?: 'choice' | 'open' | 'confirm';
  expiresAt: number;
}

export const DEFAULT_QUESTION_ANSWER_TTL_MS = 5 * 60_000;

const pending = new Map<string, PendingChannelQuestion>();

/** 生成隔离键：渠道 + 发送者 + 会话（同一发送者多会话互不串扰）。 */
export function buildQuestionKey(
  channelName: string,
  senderId: string,
  conversationId?: string
): string {
  return `${channelName}:${senderId}:${conversationId ?? ''}`;
}

export function registerPendingQuestion(
  key: string,
  question: Omit<PendingChannelQuestion, 'expiresAt'>,
  ttlMs: number = DEFAULT_QUESTION_ANSWER_TTL_MS,
  now: number = Date.now()
): void {
  pending.set(key, { ...question, expiresAt: now + ttlMs });
}

/** 读取未过期的待答问题；过期即清理并返回 `undefined`。 */
export function peekPendingQuestion(
  key: string,
  now: number = Date.now()
): PendingChannelQuestion | undefined {
  const item = pending.get(key);
  if (!item) return undefined;
  if (item.expiresAt <= now) {
    pending.delete(key);
    return undefined;
  }
  return item;
}

export function removePendingQuestion(key: string): void {
  pending.delete(key);
}

/** 测试/会话清理用：清空全部登记。 */
export function clearPendingQuestions(): void {
  pending.clear();
}
