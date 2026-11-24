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
    const grouped = tools[0].metadata?.groupedToolResults as Array<{
      content: string;
    }>;
    expect(grouped).toHaveLength(1);
    expect(grouped[0].content).toBe("second");
  });

  it("分页窗口从一轮中间开始（页内无 user）⇒ 边界工具结果不渲染", () => {
    const h = harness();
    h.run([
      msg({
        id: "t1",
        role: "tool",
        toolCallId: "call_boundary",
        timestamp: 2000,
        lastEventSeq: 11,
        content: "boundary",
      }),
      msg({
        id: "a1",
        role: "assistant",
        timestamp: 2100,
        lastEventSeq: 12,
        content: "继续",
      }),
    ]);

    // 其 assistant tool_call 在上一页 ⇒ 不是 N-48 的"真孤儿"，不显示
    expect(h.messages().some((m) => m.role === "tool")).toBe(false);
  });

  it("页内 user 消息之前的工具结果按边界残片丢弃（其后保留）", () => {
    const h = harness();
    h.run([
      msg({
        id: "t1",
        role: "tool",
        toolCallId: "call_old",
        timestamp: 2000,
        lastEventSeq: 5,
        content: "old",
      }),
      msg({
        id: "u1",
        role: "user",
        timestamp: 3000,
        lastEventSeq: 6,
        content: "hi",
      }),
      msg({
        id: "t2",
        role: "tool",
        toolCallId: "call_real_orphan",
        timestamp: 4000,
        lastEventSeq: 7,
        content: "real",
      }),
    ]);

    const tools = h.messages().filter((m) => m.role === "tool");
    expect(tools.map((m) => m.toolCallId)).toEqual(["call_real_orphan"]);
  });
});

/**
 * 2026-11-24（真机 `session_mwr473pd502e995dd1`，无事件日志的存量会话）：
 * ① 无 blocks 的 assistant 走重建路径时也必须回填工具结果（原实现只在"已有 blocks"
 *    分支注入 ⇒ 能配对的工具卡也显示「已中断 0/N」且看不到结果）；
 * ② 连续孤儿工具结果收敛为一条消息（`metadata.groupedToolResults`），
 *    由 `ToolResultGroup` 折叠渲染，避免一屏几十个「工具返回」气泡。
 */
describe("setMessagesImpl — 存量投影：重建回填 + 孤儿收敛（2026-11-24）", () => {
  it("无 blocks 的 assistant：重建出的工具块回填结果与终态", () => {
    const h = harness();
    h.run([
      msg({ id: "u1", role: "user", content: "读文件", timestamp: 1000 }),
      msg({
        id: "a1",
        role: "assistant",
        content: "读取中",
        timestamp: 1500,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "file_read", arguments: "{}" },
          },
        ] as never,
      }),
      msg({
        id: "t1",
        role: "tool",
        toolCallId: "call_1",
        timestamp: 2000,
        content: '[{"type":"tool_result","value":"hello"}]',
      }),
    ]);

    const out = h.messages();
    // 结果已被消费 ⇒ 不再单独成消息
    expect(out.some((m) => m.role === "tool")).toBe(false);
    const block = out
      .find((m) => m.role === "assistant")
      ?.blocks?.find((b) => b.type === "tool_call");
    expect(block?.toolCall?.result).toContain("hello");
    expect(block?.toolCall?.status).toBe("completed");
  });

  it("连续孤儿结果合并为一条消息，单条结果保持原样", () => {
    const h = harness();
    h.run([
      msg({ id: "u1", role: "user", content: "hi", timestamp: 1000 }),
      msg({
        id: "t1",
        role: "tool",
        toolCallId: "call_1",
        timestamp: 2000,
        content: '{"a":1}',
      }),
      msg({
        id: "t2",
        role: "tool",
        toolCallId: "call_2",
        timestamp: 3000,
        content: '{"b":2}',
      }),
      msg({
        id: "t3",
        role: "tool",
        toolCallId: "call_3",
        timestamp: 4000,
        content: '{"c":3}',
      }),
      msg({ id: "u2", role: "user", content: "继续", timestamp: 5000 }),
    ]);

    const tools = h.messages().filter((m) => m.role === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0].id).toBe("tool-group-t1");
    const grouped = tools[0].metadata?.groupedToolResults as Array<{
      toolCallId?: string;
    }>;
    expect(grouped.map((g) => g.toolCallId)).toEqual([
      "call_1",
      "call_2",
      "call_3",
    ]);
  });

  it("单条孤儿结果同样收敛为折叠组消息（本轮：不再保留独立结果卡片）", () => {
    const h = harness();
    h.run([
      msg({ id: "u1", role: "user", content: "hi", timestamp: 1000 }),
      msg({
        id: "t1",
        role: "tool",
        toolCallId: "call_1",
        timestamp: 2000,
        content: '{"a":1}',
      }),
    ]);

    const tools = h.messages().filter((m) => m.role === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0].id).toBe("tool-group-t1");
    const grouped = tools[0].metadata?.groupedToolResults as Array<{
      id: string;
    }>;
    expect(grouped.map((g) => g.id)).toEqual(["t1"]);
  });

  it("重复 setMessages（加载更早分页整表重算）不丢结果", () => {
    const h = harness();
    h.run([
      msg({ id: "u1", role: "user", content: "hi", timestamp: 1000 }),
      msg({
        id: "t1",
        role: "tool",
        toolCallId: "call_1",
        timestamp: 2000,
        content: "第一条",
      }),
      msg({
        id: "t2",
        role: "tool",
        toolCallId: "call_2",
        timestamp: 3000,
        content: "第二条",
      }),
    ]);
    // loadOlderMessages 会把已合并的列表再喂回 setMessagesImpl
    h.run(h.messages());

    const tools = h.messages().filter((m) => m.role === "tool");
    expect(tools).toHaveLength(1);
    const grouped = tools[0].metadata?.groupedToolResults as Array<{
      content: string;
    }>;
    expect(grouped.map((g) => g.content)).toEqual(["第一条", "第二条"]);
  });
});

/**
 * 2026-11-12（真机 `session_mwd7ywosc43b5503e3`）：用户在审批卡点「拒绝」后，
 * 续跑写入的终态失败结果必须把工具卡标成 `failed`。
 * 修复前：合并只回填 result/pendingApproval，`status` 沿用流式留下的 `completed`
 * ⇒ 界面显示绿色"已执行"，与"被拒绝"的事实相反。
 */
describe("setMessagesImpl — 终态结果决定工具卡状态（2026-11-12）", () => {
  const assistantWithTool = (): Message =>
    msg({
      id: "a1",
      role: "assistant",
      content: "执行中",
      timestamp: 1500,
      blocks: [
        {
          id: "b1",
          type: "tool_call",
          toolCallId: "call_denied",
          toolCall: {
            id: "call_denied",
            name: "bash",
            arguments: {},
            status: "completed",
          },
        },
      ] as never,
    });

  it("tool 消息 metadata.toolResultState=error ⇒ 工具卡 failed", () => {
    const h = harness();
    h.run([
      msg({ id: "u1", role: "user", content: "看目录" }),
      assistantWithTool(),
      msg({
        id: "t1",
        role: "tool",
        toolCallId: "call_denied",
        timestamp: 2000,
        content:
          '[{"type":"tool_result","value":"⚠️ 工具执行失败: 用户拒绝执行该工具调用（bash）"}]',
        metadata: { toolResultState: "error", isError: true } as never,
      }),
    ]);
    const block = h
      .messages()
      .find((m) => m.role === "assistant")
      ?.blocks?.find((b) => b.type === "tool_call");
    expect(block?.toolCall?.status).toBe("failed");
    // 拒绝结果不是"等待审批" ⇒ 就地审批按钮不得残留
    expect(block?.toolCall?.pendingApproval).toBeUndefined();
  });

  it("负向对照：普通成功结果 ⇒ 工具卡 completed", () => {
    const h = harness();
    h.run([
      msg({ id: "u1", role: "user", content: "看目录" }),
      assistantWithTool(),
      msg({
        id: "t1",
        role: "tool",
        toolCallId: "call_denied",
        timestamp: 2000,
        content: '[{"type":"tool_result","value":"目录列表…"}]',
        metadata: { toolResultState: "success" } as never,
      }),
    ]);
    const block = h
      .messages()
      .find((m) => m.role === "assistant")
      ?.blocks?.find((b) => b.type === "tool_call");
    expect(block?.toolCall?.status).toBe("completed");
  });
});
