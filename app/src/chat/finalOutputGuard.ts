// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * finalOutputGuard —— 助手**终稿**的 mermaid 结构校验 + 有界修复（P0-1② 覆盖面补齐）
 *
 * 背景（根因，运行时插桩已证 · 见 `.trae/specs/final-output-guard-no-tool-turns.md`）：原自纠回路钩子
 * `ReActToolLoop.onFinalOutputValidation` 只在 **ReAct 工具循环**内生效，而循环的创建被
 * 「本轮是否有 tool_calls」门控（`streamMessageFlow` 的 `finalResponse.tool_calls.length > 0`）
 * ⇒ **无工具回合的纯文本回复从不被校验**（恰是"让模型画个图"最常见的形态）。
 *
 * 本模块把「校验 → 先落盘 → 有界修复一次」抽为**单一实现**，供两条直连路径复用：
 * - 流式：`streamMessageFlow`（无 tool_calls 分支，修复后经 updateMessageBlocks 替换正文）
 * - 非流式：`ChatOrchestrator.sendMessage`（返回值尚未交给调用方，直接替换）
 *
 * 边界（如实）：
 * - 只覆盖**助手终稿**里的 mermaid 块（与 P0-1② 既有边界一致），不覆盖工具返回值。
 * - 修复**至多 1 次**；失败/无产出 ⇒ **如实原样放行**（不静默、不阻塞；CS03）。
 * - 校验器/指令模板/事件类型全部**复用**既有唯一实现（CS01），本模块不重写文案。
 *
 * 13-P2-1（2026-10-05）**收编为统一输出护栏入口**：本函数在 mermaid 校验前/后各跑一次
 * `core/outputGuard` 的统一护栏管线（由调用方从注册表注入 `outputGuards`）：
 * - 打码（`redact`）⇒ 改写正文，后续 mermaid 校验与最终产物都作用于打码后文本；
 * - 阻断（`block`）⇒ 提前返回 `blocked`（`text` 为安全替代文本），不再做修复；
 * - 修复产物再跑一次 ⇒ 防止修复轮把敏感内容带回（如实：这是一次额外同步检查，非回退）。
 */

import { createHash } from 'crypto';

import type { MermaidLintIssue } from '@modules/types/mermaid';
import type { LiriEventMap } from '@modules/session/types/eventPayloads.js';
import { runOutputGuards } from '@modules/core';
import type { OutputGuard, OutputGuardIssue } from '@modules/core';

/** 守卫依赖（由调用方注入，保持本模块零重依赖、可单测） */
export interface FinalOutputGuardDeps {
  /** 复用 `lintMermaidBlocks`；返回问题清单（空 = 通过） */
  lint: (text: string) => MermaidLintIssue[];
  /** 复用 `renderGoalTemplate('mermaid_repair', { issues: formatMermaidIssues(issues) })` */
  renderInstruction: (issues: MermaidLintIssue[]) => string;
  /** §1.6：先落 `validation/injected`，再由调用方注入修复指令 */
  emitValidationInjected: (
    issues: MermaidLintIssue[],
    instruction: string
  ) => Promise<void>;
  /** 一次有界修复；失败/无法产出 ⇒ 返回 null */
  repair: (instruction: string) => Promise<string | null>;
  /**
   * 统一输出护栏（13-P2-1；由调用方从 `getOutputGuardRegistry().list()` 注入）。
   * 省略/为空 ⇒ 只做 mermaid 校验（行为与 13-P2-1 前一致）。
   */
  outputGuards?: readonly OutputGuard[];
}

/** 守卫结果：最终正文 + 是否已修复 + 命中问题（便于调用方记录/断言） */
export interface FinalOutputGuardResult {
  text: string;
  /** 护栏**前**原文（P26-2 **P4**：调用方据此落改写审计事件；是否落**明文**由开关决定） */
  originalText: string;
  repaired: boolean;
  /** mermaid 结构问题（既有语义不变） */
  issues: MermaidLintIssue[];
  /** 统一护栏命中（13-P2-1；PII 打码 / 注入回显等） */
  guardIssues?: OutputGuardIssue[];
  /** 被统一护栏阻断（13-P2-1）：调用方应阻断外发，`text` 为安全替代文本 */
  blocked?: boolean;
  /** 阻断原因（`blocked=true` 时非空） */
  blockReason?: string;
  /** 正文被统一护栏打码改写（13-P2-1） */
  redacted?: boolean;
}

/**
 * 校验终稿并按需做**一次**修复。
 *
 * 顺序不可颠倒：**先落盘（模型将看到什么必须可从事件重建），再修复**（§1.6）。
 */
export async function guardFinalOutput(
  text: string,
  deps: FinalOutputGuardDeps
): Promise<FinalOutputGuardResult> {
  const guards = deps.outputGuards ?? [];

  // ① 统一护栏管线（13-P2-1）：打码 / 阻断 / 回显观测
  const gateBefore = guards.length ? runOutputGuards(guards, text) : null;
  if (gateBefore?.blocked) {
    return {
      text: gateBefore.text,
      originalText: text,
      repaired: false,
      issues: [],
      guardIssues: gateBefore.issues,
      blocked: true,
      blockReason: gateBefore.blockReason,
      redacted: gateBefore.redactedBy.length > 0,
    };
  }
  const guarded = gateBefore ? gateBefore.text : text;

  // ② mermaid 结构校验 + 有界修复（既有逻辑，作用于打码后文本）
  const issues = deps.lint(guarded);
  let finalText = guarded;
  let repaired = false;
  if (issues.length > 0) {
    const instruction = deps.renderInstruction(issues);
    await deps.emitValidationInjected(issues, instruction);

    let candidate: string | null = null;
    try {
      candidate = await deps.repair(instruction);
    } catch {
      // @ignore-catch — 修复属增强路径，失败必须如实原样放行（CS03），由调用方日志兜底
      candidate = null;
    }
    if (candidate && candidate.trim()) {
      finalText = candidate;
      repaired = true;
    }
  }

  // ③ 修复产物再过一次统一护栏（仅当发生修复；否则 finalText 已通过 ①）
  const gateAfter =
    repaired && guards.length ? runOutputGuards(guards, finalText) : null;
  if (gateAfter?.blocked) {
    return {
      text: gateAfter.text,
      originalText: text,
      repaired: false,
      issues,
      guardIssues: gateAfter.issues,
      blocked: true,
      blockReason: gateAfter.blockReason,
      redacted: true,
    };
  }

  const outText = gateAfter ? gateAfter.text : finalText;
  const redacted =
    (gateBefore?.redactedBy.length ?? 0) > 0 ||
    (gateAfter?.redactedBy.length ?? 0) > 0;

  return {
    text: outText,
    originalText: text,
    repaired,
    issues,
    guardIssues: [...(gateBefore?.issues ?? []), ...(gateAfter?.issues ?? [])],
    blocked: false,
    redacted,
  };
}

/**
 * 构造**输出护栏改写审计**事件载荷（P26-2 **P4**，2026-10-07）
 *
 * - **默认只出元数据**：动作 / 命中的护栏名 / 原文长度 / **原文 SHA-256**（**不含明文**）
 *   —— 可审计"发生过改写"、可对同一原文比对去重，但**不把刚打码的内容再写回磁盘**；
 * - 仅当 `keepOriginal`（= `OUTPUT_GUARD_KEEP_ORIGINAL`）为真时附 `originalText`；
 * - 未命中（既未阻断也未打码）⇒ 返回 `null`（**不落审计**，避免噪声事件）；
 * - **纯函数**（开关由调用方注入）⇒ 两态均可单测。
 */
export function buildOutputGuardAuditPayload(
  result: FinalOutputGuardResult,
  messageId: string,
  keepOriginal: boolean
): LiriEventMap['validation/output_guard_applied'] | null {
  const action = result.blocked
    ? ('blocked' as const)
    : result.redacted
      ? ('redacted' as const)
      : null;
  if (!action) return null;

  return {
    action,
    messageId,
    guards: [...new Set((result.guardIssues ?? []).map((i) => i.guard))],
    originalLength: result.originalText.length,
    originalSha256: createHash('sha256')
      .update(result.originalText, 'utf8')
      .digest('hex'),
    ...(keepOriginal ? { originalText: result.originalText } : {}),
  };
}
