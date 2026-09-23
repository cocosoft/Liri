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

// 运行方式：bun run test（vitest）—— 勿用 bun test 直接跑（vitest 专属 API）。
/**
 * N-48（2026-09-20）：`setMessagesImpl` 的**孤儿 tool 结果保留**契约。
 *
 * 背景：Phase 1 默认把 `role === 'tool'` 的消息只收进 `toolResultsByCallId`（供 Phase 3
 * 回填 assistant 的 `tool_call` 块），不回消息列表；当**没有任何 assistant 消息引用该
 * toolCallId** 时（实测 `sessions_yield` 让出轮次派生结果只有 `[user, tool]`），
 * 结果被整体丢弃 ⇒ UI 完全看不到该工具结果（台账 N-48）。本组测试守护修复后的契约。
 */
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/types";

// 重依赖打桩：本组用例只关心消息列表重建，不涉及计划任务恢复与落盘
vi.mock("@/utils/planRestore", () => ({ restorePlanTasks: vi.fn() }));
vi.mock("../chat-history.slice", () => ({
  setSessionCache: vi.fn(),
  enqueueSaveBlocks: vi.fn(),
}));

import { setMessagesImpl } from "../chat-message-set-messages";

const SID = "sid-n48";

function msg(
  partial: Partial<Message> & Pick<Message, "id" | "role">,
): Message {
  return {
    session_id: SID,
    timestamp: 1000,
    content: "",
    ...partial,
  } as Message;
}

function harness() {
  let state: Record<string, unknown> = { sessionFiles: [] };
  const set = (patch: Record<string, unknown>) => {
    state = { ...state, ...patch };
  };
  const get = () => state;
  return {
    run: (messages: Message[]) =>
      setMessagesImpl(set as never, get as never, messages),
    messages: () => state.messages as Message[],
  };
}

describe("setMessagesImpl — 孤儿 tool 结果保留（N-48）", () => {
  it("无任何 assistant 引用时，tool 结果保留在消息列表中", () => {
    const h = harness();
    h.run([
      msg({ id: "u1", role: "user", content: "请让出本轮" }),
      msg({
        id: "t1",
        role: "tool",
        toolCallId: "call_1",
        timestamp: 2000,
        content:
          '[{"type":"tool_result","value":"{\\"status\\":\\"yielded\\"}"}]',
      }),
    ]);

    const out = h.messages();
    expect(out.map((m) => m.role)).toEqual(["user", "tool"]);
    expect(out[1].toolCallId).toBe("call_1");
  });

  it("被 assistant 的 tool_call 块引用时，tool 结果不回列表（避免重复渲染）", () => {
    const h = harness();
    h.run([
      msg({ id: "u1", role: "user", content: "读文件" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "读取中",
        timestamp: 1500,
        blocks: [
          { id: "b0", type: "text", content: "读取中" },
          {
            id: "b1",
            type: "tool_call",
            toolCallId: "call_1",
            toolCall: { id: "call_1", name: "file_read", arguments: {} },
          },
        ] as never,
      }),
      msg({
        id: "t1",
        role: "tool",
        toolCallId: "call_1",
        timestamp: 2000,
        content: '{"ok":true}',
      }),
    ]);

    const out = h.messages();
    expect(out.some((m) => m.role === "tool")).toBe(false);
    const block = out
      .find((m) => m.role === "assistant")
      ?.blocks?.find((b) => b.type === "tool_call");
    expect(block?.toolCall?.result).toBeDefined();
  });

  it("同一 toolCallId 的重复孤儿只保留一条", () => {
    const h = harness();
    h.run([
      msg({ id: "u1", role: "user", content: "hi" }),
      msg({
        id: "t1",
        role: "tool",
        toolCallId: "call_dup",
        timestamp: 2000,
        content: "first",
      }),
      msg({
        id: "t2",
        role: "tool",
        toolCallId: "call_dup",
        timestamp: 2001,
        content: "second",
      }),
    ]);

    const tools = h.messages().filter((m) => m.role === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0].content).toBe("second");
  });
});
