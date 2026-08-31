/**
 * messageText.ts — 消息文本提取（搜索 / 导出双用途）
 *
 * P3-7：合并 ChatMessageList（轻量搜索版）与 SessionHeader（导出富文本版）
 * 两套重复实现，通过 { forExport } 参数区分用途。
 */

import type { Message } from "../types";
import { getToolDisplayName, getToolHumanSummary } from "./toolHumanSummary";

/**
 * 从 block.content 剥离前缀的 UI 装饰符号（⚪/▶/▼/✅/❌/🔧/📋 等）
 * 这些符号是渲染层的折叠/状态装饰，不应进入导出文本（保留纯文本可读性）
 *
 * 调试：每次替换都记录日志到 console，便于追溯哪些行没剥干净。
 * 默认关闭（避免导出时逐行打日志造成控制台爆炸）；
 * 需要调试时通过 window.__STRIP_DECORATOR_DEBUG = true 开启。
 */
export function stripLeadingDecorators(content: string): string {
  const debug =
    (globalThis as { __STRIP_DECORATOR_DEBUG?: boolean })
      .__STRIP_DECORATOR_DEBUG === true;
  const lines = content.split("\n");
  const result: string[] = [];
  const DECORATOR_RE =
    /^[\s]*(?:[⚪⚫🔴🟢🔵🟣🟡🟠◆◇●○◐◑▶▼▲◀►◄✅❌✓✗✔✘🔧🔨🛠📋📊📝💭💡🔍⚠️ℹ️⏸⏯⏵⏹🔄🔁🔀🔃🔄⏳⌛]+\s*)+/u;
  // 额外的残留符号检测（剥离后仍出现在开头）：用于发现正则没覆盖的字符
  const RESIDUAL_RE = /^[\s]*([^\w\s一-龥`'"(\[{<])/u;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.replace(DECORATOR_RE, "");
    if (debug && stripped !== line) {
      const before =
        line.length > 80 ? `${line.slice(0, 80)}…(len=${line.length})` : line;
      const after =
        stripped.length > 80
          ? `${stripped.slice(0, 80)}…(len=${stripped.length})`
          : stripped;
      console.log(
        `[stripDec][L${i}] ✂`,
        JSON.stringify(before),
        "→",
        JSON.stringify(after),
      );
    }
    if (debug && stripped) {
      const residual = stripped.match(RESIDUAL_RE);
      if (residual) {
        const cp = residual[1].codePointAt(0)?.toString(16) ?? "?";
        console.warn(
          `[stripDec][L${i}] ⚠ 残留符号 U+${cp} (${residual[1]}):`,
          JSON.stringify(stripped.slice(0, 80)),
          "原始行:",
          JSON.stringify(line.slice(0, 80)),
        );
      }
    }
    result.push(stripped);
  }
  return result.join("\n").trim();
}

/**
 * 从消息中提取文本。
 * - 默认（forExport=false）：轻量搜索版 —— content + block 原文去重 + error
 * - forExport=true：导出版 —— thinking 前置合并、装饰符号剥离、工具人话摘要、
 *   调试性 status 过滤、进度块相邻去重
 */
export function getMessageSearchText(
  message: Message,
  opts?: { forExport?: boolean },
): string {
  return opts?.forExport
    ? getMessageExportText(message)
    : getMessagePlainText(message);
}

/** 轻量搜索版：提取所有可搜索文本（含 block 内容） */
function getMessagePlainText(message: Message): string {
  const parts: string[] = [];

  if (message.content) {
    parts.push(typeof message.content === "string" ? message.content : "");
  }

  if (message.blocks && message.blocks.length > 0) {
    for (const block of message.blocks) {
      if (block.content) {
        if (
          !message.content ||
          (typeof message.content === "string" &&
            !message.content.includes(block.content))
        ) {
          parts.push(block.content);
        }
      }
    }
  }

  if (message.error) {
    parts.push(message.error);
  }

  return parts.join("\n");
}

/** 导出版：富文本提取（思考/工具/进度语义化前缀） */
function getMessageExportText(message: Message): string {
  const parts: string[] = [];
  // thinking 块前置输出，导出顺序符合"思考在前、正文在后"的阅读习惯
  // 相邻 thinking 块合并（防御流式 delta 碎片化导致重复 💭 标签）
  if (message.blocks) {
    const thinkingContents: string[] = [];
    for (const block of message.blocks) {
      if (block.type !== "thinking" || !block.content) continue;
      thinkingContents.push(String(block.content));
    }
    if (thinkingContents.length > 0) {
      const merged = stripLeadingDecorators(thinkingContents.join(""));
      if (merged.trim()) {
        // 2026-08-31：thinking 导出限长——多轮工具循环的思考会累积为超长重复内容，
        // 全量导出造成"思考泄露"观感（chat-export 实证：单块 6-7 遍自我复述）。
        // 仅导出首段摘要 + 截断说明，完整思考保留在会话内。
        const MAX_EXPORT_THINKING_CHARS = 300;
        const truncated = merged.length > MAX_EXPORT_THINKING_CHARS;
        const excerpt = truncated
          ? `${merged.slice(0, MAX_EXPORT_THINKING_CHARS)}…`
          : merged;
        parts.push(
          `💭 [思考中]\n${excerpt}${truncated ? `\n（思考过长，已截断，共 ${merged.length} 字）` : ""}`,
        );
      }
    }
  }
  if (message.content)
    parts.push(typeof message.content === "string" ? message.content : "");
  if (message.blocks) {
    // 跟踪已导出的 toolCallId，避免同一工具多状态块（running→completed→result）重复罗列
    const seenToolIds = new Set<string>();
    for (const block of message.blocks) {
      if (block.type === "thinking" || !block.content) continue;

      // 剥离所有 UI 装饰符号（⚪/▶/▼/✅/❌/🔧 等），得到纯文本
      const content = stripLeadingDecorators(String(block.content));
      // 剥离后为空（块只是装饰符号）→ 跳过
      if (!content) continue;

      // === 调试性 status 块过滤 ===
      // 丢弃后端调试状态："Running tool: xxx" / "Tool xxx completed" / "Tool xxx failed"
      // 这些是内部日志，对普通用户是噪音；真正的工具信息通过下方 tool_call 块导出
      if (
        block.type === "status" &&
        (/^Running tool:/i.test(content) ||
          /^Tool .+? completed/i.test(content) ||
          /^Tool .+? failed/i.test(content))
      ) {
        continue;
      }

      // 与渲染去重逻辑一致——content 已包含的文本块不重复导出，
      // 避免"流式累积文本 + 最终快照"双源重复
      if (
        block.type === "text" &&
        typeof message.content === "string" &&
        message.content.includes(content)
      ) {
        continue;
      }

      // === tool_call 块：使用「说人话」摘要替代技术细节 ===
      if (block.type === "tool_call" && block.toolCall) {
        const tc = block.toolCall;
        const toolKey = tc.id || tc.name;
        // 同一工具只导出一次（取最终态）
        if (toolKey && seenToolIds.has(toolKey)) continue;
        if (toolKey) seenToolIds.add(toolKey);

        const displayName = getToolDisplayName(tc.name);
        const summary = getToolHumanSummary(tc);
        // 失败工具用 ❌ 标记，其他用 🔧
        const icon = tc.status === "failed" ? "❌" : "🔧";
        // 一行简洁表达：图标 + 中文名 + 人话摘要（不再罗列 args/result JSON）
        const line = summary
          ? `${icon} ${displayName} — ${summary}`
          : `${icon} ${displayName}`;
        parts.push(line);
        continue;
      }

      // === status 块（非调试性，如 watermark/progress 等业务状态）：仅保留有 toolCallId 的结果性内容 ===
      if (block.type === "status") {
        // 无 toolCallId 的纯文本 status（如 "思考中" / "执行 N 个工具调用"）也跳过
        if (!block.toolCallId && !block.toolCall) {
          // 例外：上下文水位 / 任务分解 / 进度等业务标记保留
          if (
            /^上下文水位/.test(content) ||
            block.status === "watermark" ||
            block.status === "info"
          ) {
            parts.push(content);
          }
          continue;
        }
        // 有 toolCallId 的 status（工具结果文本）：避免与 tool_call 块重复
        const toolKey = block.toolCallId || block.toolCall?.id;
        if (toolKey && seenToolIds.has(toolKey)) continue;
        if (toolKey) seenToolIds.add(toolKey);
        // 工具结果摘要（前 200 字符，避免完整 JSON 洪泛）
        const snippet =
          content.length > 200 ? `${content.slice(0, 200)}…` : content;
        parts.push(`📋 ${snippet}`);
        continue;
      }

      // === 其他块类型：保留语义化前缀（相邻同文案 progress 合并，避免重复） ===
      if (block.type === "progress") {
        // 相邻连续相同文案的进度块（如流式过程中重复推送"正在执行工具调用"）只保留最后一条
        const lastIdx = parts.length - 1;
        const lastLine = lastIdx >= 0 ? parts[lastIdx] : "";
        if (lastLine === `📊 [进度]\n${content}` || lastLine === content) {
          continue;
        }
        parts.push(`📊 [进度]\n${content}`);
        continue;
      }
      const prefix =
        block.type === "task_decomposition" ? "📝 [任务分解]\n" : "";
      parts.push(prefix + content);
    }
  }
  if (message.error) parts.push(`❌ [错误]: ${message.error}`);
  return parts.join("\n");
}
