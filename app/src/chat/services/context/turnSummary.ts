// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 跨轮对话摘要与当前目标提取（2026-11-18，从 `MessageContextPipeline` 外移）
//
// 只读会话消息、只写 `session.metadata.contextSummary`；不参与消息数组构建。
// 对外符号与实现逐字搬迁，行为与日志 module 名（`chat:context-pipeline`）均不变。

import { getLogger } from '@openliri/infra/monitoring';
import type { ChatSession } from '@modules/session/types/session.js';
import { stripThinkResponseTags } from './thinkTags';

const logger = getLogger('chat:context-pipeline');

/** P2-3（2026-11-06）：摘要长度上限（注入下一轮上下文，不能无限膨胀） */
const TURN_SUMMARY_MAX_CHARS = 800;
/** P2-3：视为"任务目标"的用户消息最小长度（低于此值多为"继续/按计划执行"） */
const MEANINGFUL_USER_MIN_CHARS = 20;

/** 取首行并压空白（摘要用） */
function firstSummaryLine(text: string, maxChars: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

/**
 * 跨轮对话摘要持久化
 *
 * P2-3（2026-11-06，真机 `session_mw458fpp3ea32a050e` 实证）：原实现取**最后 4 条用户消息**
 * 并逐条写「用户选择: <原文>」。长任务里用户末几条常是"按计划执行/继续/没看到审批卡"，
 * 于是会话的长期上下文摘要只剩这些碎片 —— 任务目标与助手结论**全部丢失**：
 * ```
 * 此前对话决策摘要:
 * 用户选择: Continue.
 * 用户选择: 继续
 * 用户选择: 没看到命令审批卡啊，哥们。
 * ```
 * 现口径（结构化、可预测、零额外 LLM 成本）：
 * - 目标：最近 1–2 条**实质性**用户消息（≥20 字），跨多轮仍可回溯到最初任务；
 * - 指令：最近 1–2 条短指令（去重），保留"继续/按计划执行"这类上下文；
 * - 结论：最后一条有可见正文的助手消息首行（剥 `<think>`，避免把思考当结论）。
 * 总长截断到 {@link TURN_SUMMARY_MAX_CHARS}。
 */
export function persistTurnSummary(session: ChatSession): void {
  if (!session || session.messages.length < 3) return;

  const userMessages = session.messages.filter((m) => m.role === 'user');
  if (userMessages.length === 0) return;

  const textOf = (m: (typeof userMessages)[number]): string =>
    typeof m.content === 'string' ? m.content : '';

  const meaningful = userMessages
    .filter((m) => textOf(m).trim().length >= MEANINGFUL_USER_MIN_CHARS)
    .slice(-2)
    .map((m) => `- 任务目标: ${firstSummaryLine(textOf(m), 160)}`);

  const seenDirectives = new Set<string>();
  const directives = userMessages
    .filter((m) => {
      const t = textOf(m).trim();
      return t.length > 0 && t.length < MEANINGFUL_USER_MIN_CHARS;
    })
    .slice(-3)
    .map((m) => firstSummaryLine(textOf(m), 40))
    .filter((line) => {
      if (!line || seenDirectives.has(line)) return false;
      seenDirectives.add(line);
      return true;
    })
    .slice(-2)
    .map((line) => `- 用户指令: ${line}`);

  const lastAssistantText = [...session.messages]
    .reverse()
    .filter((m) => m.role === 'assistant')
    .map((m) => stripThinkResponseTags(textOf(m)).trim())
    .find((text) => text.length > 0);
  const conclusion = lastAssistantText
    ? `- 助手最近结论: ${firstSummaryLine(lastAssistantText, 200)}`
    : '';

  const lines = [...meaningful, ...directives, conclusion].filter(Boolean);
  if (lines.length === 0) return;

  const contextSummary = `此前对话决策摘要:\n${lines.join('\n')}`.slice(
    0,
    TURN_SUMMARY_MAX_CHARS
  );
  session.metadata = {
    ...session.metadata,
    contextSummary,
  };

  logger.debug('跨轮对话摘要已更新', {
    sessionId: session.id,
    summaryLength: contextSummary.length,
    hasGoal: meaningful.length > 0,
    hasConclusion: Boolean(conclusion),
  });
}

/**
 * 从会话中提取当前对话目标（最近一条实质性用户消息）
 * 过滤掉短回答、BUG 报告等非任务描述消息
 */
export function extractCurrentGoal(
  session: ChatSession,
  currentMessage?: string
): string | null {
  const candidate = currentMessage?.trim();
  if (candidate && candidate.length > 30) {
    return candidate;
  }

  const userMessages = session.messages
    .filter((m) => m.role === 'user')
    .slice(-8);

  for (let i = userMessages.length - 1; i >= 0; i--) {
    const rawContent = userMessages[i].content;
    const content = typeof rawContent === 'string' ? rawContent.trim() : '';
    if (content.length < 30) continue;
    if (/^(出?BUG|又出BUG|报错|又有BUG|出问题了)/.test(content)) continue;
    return content;
  }

  return null;
}
