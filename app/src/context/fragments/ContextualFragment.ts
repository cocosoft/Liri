// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ContextualFragment —— 注入型提示的统一类型（B3-2，2026-09-23）
 *
 * 对标 codex `codex-rs/context-fragments/src/fragment.rs:64` 的 `ContextualUserFragment`：
 * 注入进模型上下文的每一段文字都是**结构化片段**（自带类别、正文与通道前缀），
 * 渲染只有**一处**（codex 为 `render()`，此为 `renderFragment()`）——调用方不得再手写
 * `` `[SYSTEM] ${text}` `` 这类裸字符串拼接（契约见 `.trae/specs/context-contract.md` CC-06）。
 *
 * **为什么需要**：注入点是"模型可见输入"的入口。前缀与正文若在两处拼装，就会出现
 * "落盘的正文 ≠ 实际注入的正文"（`project_rules.md §1.6` 要求逐字可重建）。把前缀收进类型后：
 * - 前缀的唯一来源是 `PREFIX_BY_KIND` ⇒ 改协议前缀只改一处，且 `[SYSTEM] ` / `[STEERING] `
 *   这类**对模型可见的协议标记**不会在调用方被误当文案改动；
 * - 片段自带 `kind` / `source` / `goalId` ⇒ 注入可归因、可分别统计。
 *
 * **与 `tasks/goal/goalTemplates.ts` 的分工**：模板负责**正文文案**（`{{key}}` 占位渲染），
 * 本模块负责**片段类型 + 通道前缀**——正文原样传入，一字不改。
 *
 * **前缀归属（既有协议口径，Spec `goal-entity.md` §5.3.1 #4）**：通道前缀是**协议标记**而非文案，
 * 故 `goal_continuation` 的正文**不含**前缀（`prefix === ''`），由接收它的通道（如 steering）
 * 用自身 `kind` 拼装；`goal_instruction`（tool_result 通道）与 `steering` 则自带前缀。
 */

import { getLogger } from '@modules/monitoring';
// type-only：类型导入被擦除 ⇒ 不产生运行期依赖/循环（运行期估算走下方动态 import）
import type { ChatMessage } from '@modules/ai';

const logger = getLogger('context:fragments');

/**
 * 片段类别。决定默认通道前缀（见 `PREFIX_BY_KIND`）。
 *
 * - `system`：注入式系统指令（如重试/纠正指令）；
 * - `steering`：轮间 steering 消息（`[STEERING] `）；
 * - `goal_instruction`：目标指令经 **tool_result** 通道注入（`[SYSTEM] `）；
 * - `goal_continuation`：目标续接/收尾**正文**，经 user_message 或 steering 通道注入，
 *   前缀由通道自身拼装（此处为空）。
 */
export type FragmentKind =
  | 'system'
  | 'steering'
  | 'goal_instruction'
  | 'goal_continuation';

/**
 * 类别 → 通道前缀（**唯一来源**）。
 *
 * 不导出：调用方只能经 `createFragment()` 取片段，从而无法硬编码前缀字面量（CC-06）。
 */
const PREFIX_BY_KIND: Readonly<Record<FragmentKind, string>> = {
  system: '[SYSTEM] ',
  steering: '[STEERING] ',
  goal_instruction: '[SYSTEM] ',
  goal_continuation: '',
};

/**
 * **注入指令消息上的结构化标记字段名**（CS02：状态检测禁止字符串匹配）。
 *
 * 写入侧：所有"注入指令消息"的 push 点必须带 `[FRAGMENT_KIND_FIELD]: <FragmentKind>`
 * （如 `{ role: 'user', content: renderFragment(...), fragmentKind: 'system' }`）。
 * 读取侧：据此判别"该条是否为注入指令残留"，**禁止**用
 * `content.startsWith('[SYSTEM]')` 这类前缀字符串匹配（前缀口径变化即静默失效）。
 *
 * 选择顶层字段（而非 `metadata.*`）：这些消息是**请求侧 API 消息**
 * （`Record<string, unknown>[]`，非 `session.Message`），顶层字段是既有形态。
 * 不导出前缀本身（见 `PREFIX_BY_KIND` 不导出），故本常量只暴露**字段名**。
 */
export const FRAGMENT_KIND_FIELD = 'fragmentKind' as const;

/**
 * 全部 `FragmentKind` 对应的通道前缀（去重、去空）。
 *
 * 供**检测面**从类型派生前缀集合（如 `KnowledgeSaveTool` 判别"内容疑似引用系统指令"），
 * 而非在检测处手写前缀字面量 —— 否则协议前缀变更时检测会**静默放宽**
 * （`.trae/specs/context-contract.md` §5.2 #11）。`goal_continuation` 前缀为 `''`，被滤除。
 */
export function getAllFragmentPrefixes(): string[] {
  const seen = new Set<string>();
  for (const kind of Object.keys(PREFIX_BY_KIND) as FragmentKind[]) {
    const prefix = PREFIX_BY_KIND[kind];
    if (prefix) seen.add(prefix);
  }
  return [...seen];
}

/** 注入片段（对齐 codex `ContextualUserFragment`：正文 + 通道前缀 + 类别标识） */
export interface ContextualFragment {
  /** 片段类别（决定前缀与语义角色） */
  kind: FragmentKind;
  /** 正文（**不含**前缀；前缀在 `prefix` 字段） */
  text: string;
  /** 通道前缀（由 `kind` 决定，构造时写入；调用方不得给出） */
  prefix: string;
  /** 来源标识（可选，如 `'goal'`、`'tool_integrity'`）——供日志/事件归因 */
  source?: string;
  /** 目标标识（可选；目标类注入带此字段，便于按目标归因） */
  goalId?: string;
}

/**
 * 构造注入片段（**唯一构造入口**）。
 *
 * 前缀**恒由 `kind` 推导**，参数中不提供 prefix ⇒ 调用方无法自造前缀字面量。
 */
export function createFragment(params: {
  kind: FragmentKind;
  text: string;
  source?: string;
  goalId?: string;
}): ContextualFragment {
  const fragment: ContextualFragment = {
    kind: params.kind,
    text: params.text,
    prefix: PREFIX_BY_KIND[params.kind],
  };
  if (params.source !== undefined) fragment.source = params.source;
  if (params.goalId !== undefined) fragment.goalId = params.goalId;
  return fragment;
}

/**
 * 单条注入片段的 token 硬上限（CC-04）：超过即**违规**（须拆分/摘要）。
 * 见 `.trae/specs/context-contract.md` §2 CC-04。
 */
export const FRAGMENT_MAX_TOKENS = 10_000;

/**
 * P0 复核阈值（CC-05）：单条 >1K tokens 的注入，其变更须按 P0 显式列出量级/来源/理由
 * 并由人复核。此处作**运行时告警**（把信号变可见）。
 */
export const FRAGMENT_REVIEW_TOKENS = 1_000;

/** 廉价快路径阈值（字符）：低于此值不可能超 1K tokens（≈4 字符/token ⇒ 1K≈4K 字符），跳过精算。 */
const CHEAP_SKIP_CHARS = 2_000;

/** 片段体量判级（CC-04/CC-05） */
export type FragmentSizeVerdict = 'ok' | 'review' | 'oversized';

/**
 * 纯判级函数：按实测 token 数给 CC-04/CC-05 判级（**可测**）。
 *
 * 口径：>10K ⇒ `oversized`（CC-04 违规）；>1K ⇒ `review`（CC-05 P0 复核信号）；否则 `ok`。
 */
export function classifyFragmentSize(tokens: number): FragmentSizeVerdict {
  if (tokens > FRAGMENT_MAX_TOKENS) return 'oversized';
  if (tokens > FRAGMENT_REVIEW_TOKENS) return 'review';
  return 'ok';
}

/**
 * 运行时护栏（CC-04/CC-05）：渲染后异步观测单条体量；违规/超阈值落结构化日志。
 *
 * **为什么动态 import**：静态 `@modules/ai` 会经 `KnowledgeSaveTool → 本模块` 形成循环
 * （实测 TDZ：`Cannot access 'PREFIX_BY_KIND' before initialization`）⇒ 运行期估算按需
 * 动态 import（首次后由模块缓存命中）。
 *
 * **非阻断语义（有意）**：不抛错、不静默截断 —— 单条注入超限不应让整轮请求崩溃，也不应
 * 静默改写模型可见正文（CC-02/CC-03）。护栏是**观测面**：fire-and-forget 异步度量，
 * 让违规**当场可见**（ERROR = CC-04 违规；WARN = CC-05 P0 复核信号），由人处置（拆分/摘要）。
 */
function guardFragmentSize(
  fragment: ContextualFragment,
  rendered: string
): void {
  // 快路径：短片段绝不可能超 1K tokens ⇒ 跳过精算（避免热路径无谓 tokenize）
  if (rendered.length < CHEAP_SKIP_CHARS) return;
  void (async () => {
    try {
      const { estimateMessagesTokens } = await import('@modules/ai');
      const tokens = estimateMessagesTokens([
        { role: 'user', content: rendered } as ChatMessage,
      ]);
      const verdict = classifyFragmentSize(tokens);
      if (verdict === 'ok') return;
      const payload = {
        kind: fragment.kind,
        source: fragment.source ?? null,
        goalId: fragment.goalId ?? null,
        tokens,
        chars: rendered.length,
      };
      if (verdict === 'oversized') {
        logger.error(
          'context:fragment_oversized（CC-04 违规：单条注入 >10K tokens，须拆分/摘要）',
          { ...payload, limit: FRAGMENT_MAX_TOKENS }
        );
      } else {
        logger.warn(
          'context:fragment_large（CC-05：单条 >1K tokens，变更按 P0 复核）',
          { ...payload, review: FRAGMENT_REVIEW_TOKENS }
        );
      }
    } catch {
      // @ignore-catch — 护栏是观测面：度量失败不得影响渲染（CS03）
    }
  })();
}

/**
 * **唯一渲染入口**：`prefix + text`（不加分隔符，与 codex `render()` 同语义）。
 *
 * 与 codex 一致：分隔符/空白由**正文自身**携带，渲染器不替调用方决定。
 *
 * **运行时护栏**：渲染后调用 `guardFragmentSize()` 观测单条体量（CC-04/CC-05）；
 * 违规只落日志、**不改写正文、不抛错**。
 */
export function renderFragment(fragment: ContextualFragment): string {
  const rendered = fragment.prefix + fragment.text;
  guardFragmentSize(fragment, rendered);
  return rendered;
}
