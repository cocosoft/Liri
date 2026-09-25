// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 子代理摘要预算与溢出裁剪（方案 O9）
 *
 * 背景：worker 输出经 `substring(0, 500)` 硬编码截断进父上下文 —— **静默丢弃**且
 * 只留头部，**结尾的结论与改动清单**（最能代表"做成了什么"的部分）恰好被丢掉。
 *
 * **P2-10（2026-09-25）**：`computeSummaryCharBudget` 的**公式与常量已迁入统一预算策略层**
 * （`core/tokenBudget/BudgetPolicy.ts` 的 `subagent.summary-chars`），本模块改为**委托**
 * ⇒ **导出名 / 签名 / 返回值不变**、调用方零改动（设计见 `.trae/specs/budget-policy-layer.md`）。
 * `trimSummaryWithFooter`（head 75% + tail 25% 裁剪）仍在本模块，逻辑未变。
 *
 * ⚠ G14（必须遵守的取数口径）：预算的输入必须是**最后一次 API 调用的 `prompt_tokens`**
 * （父**当前**上下文大小），**不得用累计 token** —— 后者在几百次调用后会超过任何窗口，
 * 导致所有摘要被压到下限（Hermes 因此把 1393 条摘要全塌到 2000 字符）。
 */

import {
  SUMMARY_HARD_MAX_CHARS,
  SUMMARY_MIN_CHARS,
  SUMMARY_HEAD_RATIO,
  evaluateSummaryCharBudget,
} from '@modules/core/tokenBudget/BudgetPolicy';
import type { SummaryBudgetInput } from '@modules/core/tokenBudget/BudgetPolicy';

// 常量与输入类型的**公共 API 保持不变**（实现迁入策略层后在此 re-export）
export { SUMMARY_HARD_MAX_CHARS, SUMMARY_MIN_CHARS, SUMMARY_HEAD_RATIO };
export type { SummaryBudgetInput };

/**
 * 计算单个 worker 摘要的字符预算。
 *
 * **委托**统一预算策略层（`subagent.summary-chars`）—— 规则与 G14 口径见
 * `core/tokenBudget/BudgetPolicy.ts`（那里是这两个量的**单一实现**）。
 */
export function computeSummaryCharBudget(input: SummaryBudgetInput): number {
  return evaluateSummaryCharBudget(input);
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
