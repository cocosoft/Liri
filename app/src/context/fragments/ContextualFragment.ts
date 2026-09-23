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
 * **唯一渲染入口**：`prefix + text`（不加分隔符，与 codex `render()` 同语义）。
 *
 * 与 codex 一致：分隔符/空白由**正文自身**携带，渲染器不替调用方决定。
 */
export function renderFragment(fragment: ContextualFragment): string {
  return fragment.prefix + fragment.text;
}
