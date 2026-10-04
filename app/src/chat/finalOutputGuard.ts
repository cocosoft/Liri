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
 */

import type { MermaidLintIssue } from '@modules/types/mermaid';

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
}

/** 守卫结果：最终正文 + 是否已修复 + 命中问题（便于调用方记录/断言） */
export interface FinalOutputGuardResult {
  text: string;
  repaired: boolean;
  issues: MermaidLintIssue[];
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
  const issues = deps.lint(text);
  if (issues.length === 0) return { text, repaired: false, issues };

  const instruction = deps.renderInstruction(issues);
  await deps.emitValidationInjected(issues, instruction);

  let repaired: string | null = null;
  try {
    repaired = await deps.repair(instruction);
  } catch {
    // @ignore-catch — 修复属增强路径，失败必须如实原样放行（CS03），由调用方日志兜底
    repaired = null;
  }
  if (!repaired || !repaired.trim()) return { text, repaired: false, issues };
  return { text: repaired, repaired: true, issues };
}
