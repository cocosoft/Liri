// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 上下文折叠管理器 (ContextFolder)
 *
 * 借鉴 DeepSeek-Reasonix ContextManager 的 5 级阈值自适应折叠策略。
 * 与现有 TokenBudgetManager、ContextTracker、IContextEngine 体系集成。
 *
 * 借鉴: DeepSeek-Reasonix src/context-manager.ts
 */

import { getLogger } from '@modules/monitoring';
import type { ChatMessage } from '../tools/repair/types';
import { healLoadedMessages } from './healing';
import { looksLikeCompleteJson } from './shrink';
import { estimateMessagesTokens } from '@modules/ai';

const logger = getLogger('query:contextFolder');

// ─── 折叠阈值常量 ────────────────────────────────────────────────────────────

/** 历史折叠阈值：当 prompt token 使用率超过此值时触发正常折叠 */
export const HISTORY_FOLD_THRESHOLD = 0.75;
/** 正常折叠后的尾部预算占比 */
export const HISTORY_FOLD_TAIL_FRACTION = 0.2;
/** 激进折叠阈值：超过此值触发更激进的折叠 */
export const HISTORY_FOLD_AGGRESSIVE_THRESHOLD = 0.78;
/** 激进折叠后的尾部预算占比（更小，牺牲更多近期上下文换取空间） */
export const HISTORY_FOLD_AGGRESSIVE_TAIL_FRACTION = 0.1;
/** 最小节省比例：折叠节省的 token 低于此比例则跳过 */
export const HISTORY_FOLD_MIN_SAVINGS_FRACTION = 0.3;
/** 强制摘要退出阈值：超过此值不折叠，直接退出并生成摘要 */
export const FORCE_SUMMARY_THRESHOLD = 0.8;
/** 回合开始时预估 token 超过此阈值，触发预折叠 */
export const TURN_START_FOLD_THRESHOLD = 0.9;
/** 折叠摘要超时（毫秒） */
export const HISTORY_FOLD_SUMMARY_TIMEOUT_MS = 15_000;

/** 折叠摘要标记 — 让模型知道这是合成摘要 */
export const HISTORY_FOLD_MARKER =
  '[对话历史摘要 — 以下为之前对话的压缩摘要]\n\n';
/** 技能 pin memo 保留头部 */
export const SKILL_PIN_MEMO_HEADER =
  '[Active skill memos — preserved verbatim across the fold:]';

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** 折叠决策类型 */
export type FoldDecisionKind = 'none' | 'fold' | 'exit-with-summary';

/** 折叠决策 */
export interface FoldDecision {
  kind: FoldDecisionKind;
  promptTokens: number;
  ctxMax: number;
  ratio: number;
  /** 折叠加的尾部 token 预算 */
  tailBudget?: number;
  /** 是否为激进折叠 */
  aggressive?: boolean;
}

/** 折叠结果 */
export interface FoldResult {
  folded: boolean;
  beforeMessages: number;
  afterMessages: number;
  summaryChars: number;
  savedTokens: number;
}

/** 高优先级约束提取结果 */
interface PinnedConstraints {
  userMemory: string[];
  projectMemory: string[];
  constraints: string[];
}

/** 对话摘要生成器接口（可由外部 AI 客户端实现） */
export interface SummaryGenerator {
  /** 生成对话摘要 */
  summarize(
    messages: ChatMessage[],
    instruction: string,
    model: string,
    abortSignal: AbortSignal
  ): Promise<{ content: string; reasoningContent: string }>;
}

/** ContextFolder 依赖 */
export interface ContextFolderDeps {
  /** 上下文窗口大小 */
  ctxMax: number;
  /** 获取当前系统提示词 */
  getSystemPrompt: () => string;
  /** 摘要生成器 */
  summaryGenerator: SummaryGenerator;
  /** 当前模型名 */
  model: string;
  /** 摘要模型（通常为轻量模型） */
  summaryModel?: string;
  /** 获取中止信号 */
  getAbortSignal?: () => AbortSignal;
  /** 折叠后回调 */
  onFold?: (result: FoldResult) => void;
}

// ─── ContextFolder 类 ────────────────────────────────────────────────────────

export class ContextFolder {
  private deps: ContextFolderDeps;
  private alreadyFoldedThisTurn: boolean = false;

  constructor(deps: ContextFolderDeps) {
    this.deps = deps;
  }

  /**
   * 根据使用量决策：是否需要折叠
   */
  decideAfterUsage(promptTokens: number): FoldDecision {
    const { ctxMax } = this.deps;
    const ratio = promptTokens / ctxMax;
    const base = { promptTokens, ctxMax, ratio };

    if (ratio > FORCE_SUMMARY_THRESHOLD) {
      return { kind: 'exit-with-summary', ...base };
    }
    if (this.alreadyFoldedThisTurn) return { kind: 'none', ...base };
    if (ratio > HISTORY_FOLD_AGGRESSIVE_THRESHOLD) {
      return {
        kind: 'fold',
        ...base,
        tailBudget: Math.floor(ctxMax * HISTORY_FOLD_AGGRESSIVE_TAIL_FRACTION),
        aggressive: true,
      };
    }
    if (ratio > HISTORY_FOLD_THRESHOLD) {
      return {
        kind: 'fold',
        ...base,
        tailBudget: Math.floor(ctxMax * HISTORY_FOLD_TAIL_FRACTION),
        aggressive: false,
      };
    }
    return { kind: 'none', ...base };
  }

  /**
   * 回合开始时预估 token 使用量
   */
  estimateTurnStart(
    messages: ChatMessage[],
    toolCount: number
  ): { estimateTokens: number; ctxMax: number; ratio: number } {
    const { ctxMax } = this.deps;
    // BUG-L fix: use estimateMessagesTokens (tiktoken + CJK + role overhead) instead of local heuristic
    const estimate = estimateMessagesTokens(messages) + toolCount * 200;
    return { estimateTokens: estimate, ctxMax, ratio: estimate / ctxMax };
  }

  /**
   * 执行折叠
   *
   * 1. 从尾部向前扫描，保留 tailBudget 以内的最近消息
   * 2. 对头部消息生成摘要
   * 3. 用摘要替换头部消息
   */
  async fold(
    messages: ChatMessage[],
    opts?: { keepRecentTokens?: number; requireTailBoundary?: boolean }
  ): Promise<{ messages: ChatMessage[]; result: FoldResult }> {
    const { ctxMax } = this.deps;
    const tailBudget =
      opts?.keepRecentTokens ?? Math.floor(ctxMax * HISTORY_FOLD_TAIL_FRACTION);
    const noop: FoldResult = {
      folded: false,
      beforeMessages: messages.length,
      afterMessages: messages.length,
      summaryChars: 0,
      savedTokens: 0,
    };
    if (messages.length === 0) return { messages, result: noop };

    // BUG-L fix: use estimateMessagesTokens (tiktoken + CJK + role overhead)
    const tokenCounts = messages.map((m) => estimateMessagesTokens([m]));
    const totalTokens = tokenCounts.reduce((a, b) => a + b, 0);

    // 从尾部向前扫描，找到边界
    let cumTokens = 0;
    let boundary = messages.length;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (cumTokens + tokenCounts[i]! > tailBudget) break;
      cumTokens += tokenCounts[i]!;
      if (messages[i]!.role === 'user') boundary = i;
    }
    if (boundary <= 0) return { messages, result: noop };
    if (opts?.requireTailBoundary && boundary >= messages.length)
      return { messages, result: noop };

    const head = messages.slice(0, boundary);
    const tail = messages.slice(boundary);
    const headTokens = totalTokens - cumTokens;
    if (headTokens < totalTokens * HISTORY_FOLD_MIN_SAVINGS_FRACTION) {
      return { messages, result: noop };
    }

    // 提取高优先级约束
    const constraints = extractPinnedConstraints(this.deps.getSystemPrompt());
    const constraintText = constraints
      ? `\n\n[PINNED CONSTRAINTS — preserved verbatim]\n\n${constraints}`
      : '';

    // 生成摘要
    const summary = await this.summarizeForFold(head);
    if (!summary.content) return { messages, result: noop };

    const summaryContent =
      HISTORY_FOLD_MARKER + summary.content + constraintText;
    const summaryMsg: ChatMessage = {
      role: 'user',
      content: summaryContent,
    };

    const replacement = [summaryMsg, ...tail];
    this.alreadyFoldedThisTurn = true;

    const result: FoldResult = {
      folded: true,
      beforeMessages: messages.length,
      afterMessages: replacement.length,
      summaryChars: summary.content.length,
      savedTokens:
        headTokens -
        estimateMessagesTokens([
          { role: 'user', content: summaryContent } as ChatMessage,
        ]),
    };

    this.deps.onFold?.(result);
    return { messages: replacement, result };
  }

  /**
   * 回合结束时重置折叠标记
   */
  resetTurn(): void {
    this.alreadyFoldedThisTurn = false;
  }

  // ─── 私有方法 ──────────────────────────────────────────────────────────

  private async summarizeForFold(
    messagesToSummarize: ChatMessage[]
  ): Promise<{ content: string; reasoningContent: string }> {
    const summaryModel = this.deps.summaryModel ?? this.deps.model;
    const healed = healLoadedMessages(messagesToSummarize, 8000);
    const instruction = buildFoldSummaryInstruction();
    const abortSignal =
      this.deps.getAbortSignal?.() ?? new AbortController().signal;

    // 超时控制
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(),
      HISTORY_FOLD_SUMMARY_TIMEOUT_MS
    );

    try {
      const combinedSignal = combineAbortSignals(
        abortSignal,
        timeoutController.signal
      );
      return await this.deps.summaryGenerator.summarize(
        healed.messages,
        instruction,
        summaryModel,
        combinedSignal
      );
    } catch (err) {
      logger.warn('Fold summary failed', { error: (err as Error).message });
      return { content: '', reasoningContent: '' };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** 构建折叠摘要指令 */
function buildFoldSummaryInstruction(): string {
  return (
    "Summarize the conversation above as one self-contained prose recap. Preserve the user's " +
    'ORIGINAL OBJECTIVE (never paraphrase away negative constraints like "do NOT do X"), all ' +
    '"do not" / "never" / "avoid" instructions, decisions reached, files inspected or modified, ' +
    'tool results still relevant, and any open todos. Skip turn-by-turn play-by-play. ' +
    'Output plain prose only — no tool calls, no markdown headings, no SEARCH/REPLACE blocks.'
  );
}

/** 提取对话中的高优先级约束 */
function extractPinnedConstraints(systemPrompt: string): string {
  // BUG-C fix: also match ## heading levels + inline labels (e.g. "# HIGH PRIORITY constraints: do not...")
  const heading = `#{1,2}`;
  const label = '(?:HIGH PRIORITY constraints|User memory|Project memory)';
  const pattern = new RegExp(
    `${heading} ${label}[\\s\\S]*?(?=\\n${heading} |\\n---|$)`,
    'g'
  );
  return Array.from(systemPrompt.matchAll(pattern), (m) => m[0]).join('\n\n');
}

/** 合并两个 AbortSignal（使用标准 API，无监听泄漏） */
function combineAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  return AbortSignal.any([a, b]);
}

// ─── 便捷导出 ────────────────────────────────────────────────────────────────

export { extractPinnedConstraints };
