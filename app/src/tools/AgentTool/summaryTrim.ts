// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 子代理摘要预算与溢出裁剪（方案 O9）
 *
 * 背景：worker 输出经 `substring(0, 500)` 硬编码截断进父上下文 —— **静默丢弃**且
 * 只留头部，**结尾的结论与改动清单**（最能代表"做成了什么"的部分）恰好被丢掉。
 *
 * 本模块提供两件纯逻辑（无 IO、可独立单测）：
 * 1. `computeSummaryCharBudget` —— 按父**当前**剩余上下文余量算预算（50% ÷ worker 数），
 *    硬顶 24000 / 下限 2000；**父上下文未知时退化为下限**（不臆测）。
 * 2. `trimSummaryWithFooter` —— 超限时 **head 75% + tail 25%**（行边界回退/前推），
 *    并写明被省略的字符数与"全文落盘指针"（由调用方给出）。
 *
 * ⚠ G14（必须遵守的取数口径）：预算的输入必须是**最后一次 API 调用的 `prompt_tokens`**
 * （父**当前**上下文大小），**不得用累计 token** —— 后者在几百次调用后会超过任何窗口，
 * 导致所有摘要被压到下限（Hermes 因此把 1393 条摘要全塌到 2000 字符）。
 */

/** 摘要硬顶（字符） */
export const SUMMARY_HARD_MAX_CHARS = 24000;
/** 摘要下限（字符）——父上下文未知时的退化值 */
export const SUMMARY_MIN_CHARS = 2000;
/** head 占比：head 75% / tail 25% */
export const SUMMARY_HEAD_RATIO = 0.75;

export interface SummaryBudgetInput {
  /**
   * 父**当前**上下文的 prompt tokens（最后一次 API 调用的取值）。
   * `undefined` = 未知 ⇒ 退化为 {@link SUMMARY_MIN_CHARS}。
   */
  parentPromptTokens?: number;
  /** 模型上下文窗口（tokens，来自 DB 的 `context_window`） */
  contextWindow?: number;
  /** 同批 worker 数（预算需按数量分摊） */
  workerCount: number;
  /** 每 token 约多少字符（缺省 3.5，仅用于字符预算换算） */
  charsPerToken?: number;
}

/**
 * 计算单个 worker 摘要的字符预算。
 *
 * 规则：`剩余 = 窗口 − 当前占用` ⇒ `预算 = 剩余 × 50% ÷ workerCount`（换算成字符），
 * 再夹到 [`SUMMARY_MIN_CHARS`, `SUMMARY_HARD_MAX_CHARS`]；**任一项未知则退化下限**。
 */
export function computeSummaryCharBudget(input: SummaryBudgetInput): number {
  const { parentPromptTokens, contextWindow, workerCount } = input;
  const charsPerToken = input.charsPerToken ?? 3.5;

  if (
    typeof parentPromptTokens !== 'number' ||
    typeof contextWindow !== 'number' ||
    !Number.isFinite(parentPromptTokens) ||
    !Number.isFinite(contextWindow) ||
    workerCount <= 0
  ) {
    return SUMMARY_MIN_CHARS;
  }

  const remaining = Math.max(0, contextWindow - parentPromptTokens);
  const perWorkerTokens = (remaining * 0.5) / workerCount;
  const chars = Math.floor(perWorkerTokens * charsPerToken);

  return Math.min(SUMMARY_HARD_MAX_CHARS, Math.max(SUMMARY_MIN_CHARS, chars));
}

export interface TrimmedSummary {
  /** 裁剪后的文本（未超限时原样返回） */
  text: string;
  /** 是否发生了裁剪 */
  truncated: boolean;
  /** 被省略的字符数（未裁剪为 0） */
  omittedChars: number;
}

/**
 * 超限裁剪：**head 75% + tail 25%**，边界对齐整行。
 *
 * - head：从 75% 位置**向前**回退到最近的换行（避免切半行）；
 * - tail：从 25% 起点**向后**推到最近的换行（同上）；
 * - 尾部对齐后若与 head 相接或越界 ⇒ 退化为"按预算直接截断"（保证不死循环/不抛错）；
 * - 裁剪处插入一行标记，说明省略字符数与全文位置（`spillPath` 可选）。
 */
export function trimSummaryWithFooter(
  text: string,
  maxChars: number,
  opts: { spillPath?: string } = {}
): TrimmedSummary {
  const limit = Math.max(1, Math.floor(maxChars));
  if (text.length <= limit) {
    return { text, truncated: false, omittedChars: 0 };
  }

  const headBudget = Math.floor(limit * SUMMARY_HEAD_RATIO);
  const tailBudget = limit - headBudget;

  // head：切点向前回退到行边界（找不到则用原切点）
  let headEnd = headBudget;
  const lastNlBeforeHead = text.lastIndexOf('\n', headBudget);
  if (lastNlBeforeHead > 0) {
    headEnd = lastNlBeforeHead;
  }

  // tail：起点向后推到行边界（找不到则用原起点）
  let tailStart = text.length - tailBudget;
  const firstNlAfterTail = text.indexOf('\n', tailStart);
  if (firstNlAfterTail >= 0 && firstNlAfterTail < text.length - 1) {
    tailStart = firstNlAfterTail + 1;
  }

  // 退化保护：两段相接/越界 ⇒ 直接按预算截断（仍保留 head+tail 语义）
  if (tailStart <= headEnd) {
    tailStart = Math.max(headEnd + 1, text.length - tailBudget);
  }
  if (tailStart <= headEnd) {
    const fallback = text.slice(0, limit);
    return {
      text: fallback,
      truncated: true,
      omittedChars: text.length - fallback.length,
    };
  }

  const head = text.slice(0, headEnd);
  const tail = text.slice(tailStart);
  const omitted = text.length - head.length - tail.length;
  const pointer = opts.spillPath ? `，全文见：${opts.spillPath}` : '';
  const marker = `\n\n… [已省略 ${omitted} 个字符${pointer}] …\n\n`;

  return {
    text: head + marker + tail,
    truncated: true,
    omittedChars: omitted,
  };
}
