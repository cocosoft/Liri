/**
 * O2-4（2026-09-24「会话暴露问题分析与优化方案」§五，跨端修复）：
 * 派生层对 `assistant/text.replace` 的处理 —— **续接/重试轮的正文取代前一轮**，
 * 使流内视图（前一轮文本 + 本轮文本）不再出现重复段落，且与落盘
 * `assistantMessage.content`（后端每轮整体替换）同源（project_rules §1.6「所见即所存」）。
 *
 * 「修复前必失败」：无 replace 处理时，两条 text 事件会被 append ⇒ 正文出现重复前缀。
 */

import { describe, expect, it } from "vitest";
import type { LiriEvent } from "@/types";
import { deriveConversationBlocks } from "../deriveConversationBlocks";

const SID = "sid-o2-4";

function ev(
  seq: number,
  type: LiriEvent["type"],
  data: Record<string, unknown> = {},
  time = 1000 + seq,
): LiriEvent {
  return { type, seq, time, sessionId: SID, data: data as never };
}

function assistantText(events: LiriEvent[]): string {
  const msgs = deriveConversationBlocks(events);
  const assistant = msgs.find((m) => m.role === "assistant");
  expect(assistant).toBeDefined();
  return (assistant!.blocks ?? [])
    .filter((b) => b.type === "text")
    .map((b) => String(b.content ?? ""))
    .join("");
}

describe("O2-4 正文取代（assistant/text.replace）", () => {
  it("续接轮 replace=true ⇒ 取代前一轮正文，不出现重复前缀（修复前必失败）", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "帮我分析" }),
      // 第 1 轮：被截断的残缺正文（已下发）
      ev(3, "assistant/text", { content: "我先定位这两个文件。" }),
      // 续接轮：正文从开头重写 —— 后端把它**整体替换**为 assistantMessage.content
      ev(4, "assistant/text", {
        content: "我先定位这两个文件。我先建个计划。",
        replace: true,
      }),
      ev(5, "turn/end", { turn: 1 }),
    ];

    const text = assistantText(events);

    // 修复前：append ⇒ "我先定位这两个文件。我先定位这两个文件。我先建个计划。"
    expect(text).toBe("我先定位这两个文件。我先建个计划。");
    expect(text).not.toContain("我先定位这两个文件。我先定位这两个文件。");
  });

  it("replace 只取代**尾部**正文：工具轮之间的旁白不受影响", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "user/message", { content: "改一下" }),
      // 第 1 轮旁白 + 工具调用
      ev(3, "assistant/text", { content: "我先看看文件。" }),
      ev(4, "assistant/tool_call", {
        toolCallId: "tc-1",
        name: "read_file",
        args: { path: "a.ts" },
      }),
      // 第 2 轮截断后重试 ⇒ 只取代第 2 轮的正文
      ev(5, "assistant/text", { content: "残缺的结论" }),
      ev(6, "assistant/text", { content: "完整结论如下。", replace: true }),
      ev(7, "turn/end", { turn: 1 }),
    ];

    const text = assistantText(events);

    expect(text).toContain("我先看看文件。");
    expect(text).toContain("完整结论如下。");
    expect(text).not.toContain("残缺的结论");
  });
});
