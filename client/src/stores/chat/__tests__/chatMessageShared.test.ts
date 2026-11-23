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

// T1.1（2026-08-23）：dedupeToolCallBlocks 合并去重测试
import { describe, it, expect } from "vitest";
import {
  collectApprovalInboxIds,
  dedupeToolCallBlocks,
  hasPendingApproval,
  hasPendingApprovalCard,
  markApprovalResolvedInMessages,
  parseApprovalSignal,
  preferToolResult,
  resolveApprovalFlags,
  resolvedApprovalInboxIds,
  stripStaleApprovalNotice,
} from "../chat-message-shared";
import type { MessageBlock } from "@/types";

function toolBlock(
  id: string,
  args: Record<string, unknown> | undefined,
  status: string,
): MessageBlock {
  return {
    id: `blk_${id}_${Math.random().toString(36).slice(2, 8)}`,
    type: "tool_call",
    content: "tool",
    toolCall: { id, name: "tool", arguments: args, status },
    toolCallId: id,
    isStreaming: false,
    groupId: "grp_test",
  };
}

describe("dedupeToolCallBlocks — 同 toolCallId 合并去重（T1.1）", () => {
  it("无重复时原样返回（保留 tool_start 带 args + tool_end 终态 双块）", () => {
    const blocks = [toolBlock("call_1", { a: 1 }, "running")];
    expect(dedupeToolCallBlocks(blocks)).toHaveLength(1);
  });

  it("tool_start/tool_end 双 chunk 正常场景（同 id 2 块）合并为 1 块，保留终态 status + 首个非空 arguments", () => {
    const start = toolBlock("call_1", { file_path: "/tmp/a" }, "running");
    const end = toolBlock("call_1", {}, "completed");
    const result = dedupeToolCallBlocks([start, end]);
    expect(result).toHaveLength(1);
    expect(result[0].toolCall?.status).toBe("completed");
    expect(result[0].toolCall?.arguments).toEqual({ file_path: "/tmp/a" });
  });

  it("重复 4 块（2 带 args + 2 空 args）合并为 1 块，保留终态 + 首非空 arguments", () => {
    const blocks = [
      toolBlock("call_1", { file_path: "/tmp/a" }, "running"),
      toolBlock("call_1", { file_path: "/tmp/a" }, "running"),
      toolBlock("call_1", {}, "completed"),
      toolBlock("call_1", {}, "completed"),
    ];
    const result = dedupeToolCallBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].toolCall?.status).toBe("completed");
    expect(result[0].toolCall?.arguments).toEqual({ file_path: "/tmp/a" });
  });

  it("不同 toolCallId 的块互不影响", () => {
    const blocks = [
      toolBlock("call_1", { a: 1 }, "completed"),
      toolBlock("call_2", { b: 2 }, "completed"),
    ];
    const result = dedupeToolCallBlocks(blocks);
    expect(result).toHaveLength(2);
  });

  it("非 tool_call 块原样保留（顺序不变）", () => {
    const text: MessageBlock = {
      id: "blk_text",
      type: "text",
      content: "正文",
      isStreaming: false,
    };
    const start = toolBlock("call_1", { a: 1 }, "running");
    const end = toolBlock("call_1", {}, "completed");
    const result = dedupeToolCallBlocks([text, start, end]);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("text");
    expect(result[1].toolCall?.status).toBe("completed");
  });
});

describe("parseApprovalSignal — 审批等待信号（U-06-5）", () => {
  it("awaiting_approval 结果（含 inboxId）⇒ pendingApproval + inboxId", () => {
    const raw = JSON.stringify({
      status: "awaiting_approval",
      message: "需要审批",
      pendingApproval: true,
      inboxId: "ib-1",
    });
    expect(parseApprovalSignal(raw)).toEqual({
      pendingApproval: true,
      inboxId: "ib-1",
    });
  });

  it("pendingApproval=true 但无 inboxId ⇒ 仍返回信号（按钮不渲染，退回收件箱）", () => {
    const raw = JSON.stringify({ pendingApproval: true });
    expect(parseApprovalSignal(raw)).toEqual({
      pendingApproval: true,
      inboxId: undefined,
    });
  });

  it("普通 JSON 结果 / 非 JSON 文本 / 非字符串 ⇒ null（不误判为审批态）", () => {
    expect(parseApprovalSignal(JSON.stringify({ output: "done" }))).toBeNull();
    expect(parseApprovalSignal("plain text result")).toBeNull();
    expect(parseApprovalSignal(undefined)).toBeNull();
    expect(parseApprovalSignal({ pendingApproval: true })).toBeNull();
  });
});

/**
 * 2026-11-12（真机 `session_mwd632bob8d4318050`）：批准后同一调用出现**两张卡**
 * （服务端合成的「已处理」Inbox 卡 + 工具卡上残留的「等待审批」）。
 * 根因：审批等待标记只置位、终态结果从不清除。
 */
describe("resolveApprovalFlags — 终态结果清除等待标记", () => {
  it("awaiting 结果 ⇒ 置位并带 inboxId", () => {
    const raw = JSON.stringify({ pendingApproval: true, inboxId: "ib-1" });
    expect(resolveApprovalFlags(raw)).toEqual({
      pendingApproval: true,
      inboxId: "ib-1",
    });
  });

  it("终态结果（成功/失败/普通文本）⇒ pendingApproval 清除", () => {
    expect(resolveApprovalFlags("目录列表…")).toEqual({
      pendingApproval: undefined,
      inboxId: undefined,
    });
    expect(resolveApprovalFlags(JSON.stringify({ output: "done" }))).toEqual({
      pendingApproval: undefined,
      inboxId: undefined,
    });
    expect(resolveApprovalFlags("⚠️ 工具执行失败: 拒绝")).toEqual({
      pendingApproval: undefined,
      inboxId: undefined,
    });
  });

  it("对象形态的审批结果同样识别（事件 chunk 走对象）", () => {
    expect(resolveApprovalFlags({ pendingApproval: true })).toEqual({
      pendingApproval: true,
      inboxId: undefined,
    });
  });
});

describe("preferToolResult — 同 toolCallId 两条结果时终态优先", () => {
  const awaiting = JSON.stringify({ pendingApproval: true, inboxId: "ib-1" });
  const terminal = "命令输出：file1 file2";

  it("首次结果直接采用", () => {
    expect(preferToolResult(undefined, awaiting)).toBe(true);
  });

  it("占位在前、终态在后 ⇒ 采用终态", () => {
    expect(preferToolResult(awaiting, terminal)).toBe(true);
  });

  it("终态在前、占位在后（顺序颠倒）⇒ 保留终态", () => {
    expect(preferToolResult(terminal, awaiting)).toBe(false);
  });

  it("两条都是终态 ⇒ 后写覆盖（原行为不变）", () => {
    expect(preferToolResult(terminal, "另一条结果")).toBe(true);
  });
});

/**
 * 2026-11-12（真机 `session_mwd7ywosc43b5503e3`）：审批处理完后，正文里那句
 * 「⏸ 有工具调用正在等待你的审批…」仍留在气泡，与实际状态矛盾 ⇒ 渲染期按
 * **结构化标记**（awaiting_approval）剥离，改由审批卡片在 pending 时提示。
 */
describe("stripStaleApprovalNotice — 审批等待收尾提示剥离（2026-11-12）", () => {
  const notice =
    "⏸ 有工具调用正在等待你的审批：请在下方审批卡片（或收件箱）中处理后继续；批准后会自动接着执行，无需重发消息。";

  it("带 awaiting_approval 标记 ⇒ 正文与 text 块都被剥离", () => {
    const msg = {
      role: "assistant",
      content: `我来执行命令。\n\n${notice}`,
      metadata: { terminationReason: "awaiting_approval" },
      blocks: [
        { type: "text", content: `我来执行命令。\n\n${notice}` },
        { type: "tool_call", content: "" },
      ],
    };
    const out = stripStaleApprovalNotice(msg);
    expect(out.content).toBe("我来执行命令。");
    expect(out.blocks?.[0]?.content).toBe("我来执行命令。");
    // 非 text 块原样保留
    expect(out.blocks?.[1]).toBe(msg.blocks[1]);
  });

  it("无 awaiting_approval 标记 ⇒ 一字不动（避免误伤普通正文）", () => {
    const msg = {
      role: "assistant",
      content: `正文\n\n${notice}`,
      metadata: {},
    };
    expect(stripStaleApprovalNotice(msg)).toBe(msg);
  });

  it("顶层 finishReason 标记同样生效（事件派生消息）", () => {
    const msg = { role: "assistant", content: notice, finishReason: "awaiting_approval" };
    expect(stripStaleApprovalNotice(msg).content).toBe("");
  });
});

/**
 * P0-1（2026-11-06）：流式收尾后是否需要补拉审批卡片。
 *
 * 真机背景：`inbox:new` 广播早于本轮 assistant 消息落盘 ⇒ 那次刷新拿不到卡片，
 * 随后流式写入又覆盖本地列表 ⇒ 用户不刷新页面看不到审批卡。
 */
describe("hasPendingApprovalCard — 是否已有待处理审批卡片（P0-1）", () => {
  const inboxBlock = (
    status: "pending" | "replied" | "expired",
  ): MessageBlock =>
    ({
      id: `blk_inbox_${status}`,
      type: "inbox",
      content: "",
      inboxData: {
        inboxId: "ib-1",
        type: "approval",
        title: "工具审批: bash",
        content: "",
        status,
        actions: [],
      },
    }) as MessageBlock;

  it("含 pending 审批块 ⇒ true", () => {
    expect(hasPendingApprovalCard([{ blocks: [inboxBlock("pending")] }])).toBe(
      true,
    );
  });

  it("仅 replied / expired ⇒ false（不重复补拉）", () => {
    expect(
      hasPendingApprovalCard([
        { blocks: [inboxBlock("replied"), inboxBlock("expired")] },
      ]),
    ).toBe(false);
  });

  it("空列表 / 无 blocks / 非 inbox 块 ⇒ false", () => {
    expect(hasPendingApprovalCard([])).toBe(false);
    expect(hasPendingApprovalCard([{}])).toBe(false);
    expect(
      hasPendingApprovalCard([
        { blocks: [{ id: "b", type: "text", content: "hi" }] },
      ]),
    ).toBe(false);
  });
});

/**
 * 2026-11-13（真机 `session_mwdcivrue74d4838ff`）：审批等待期间浮动栏/任务卡仍显示
 * 「已完成 x/y / 已结束」⇒ 用户以为任务跑完了。本判定是**会话级**等待信号（结构化字段）。
 */
describe("hasPendingApproval — 会话是否在等待审批（2026-11-13）", () => {
  const inbox = (
    status: "pending" | "replied" | "expired",
    type: "approval" | "question" = "approval",
  ): MessageBlock =>
    ({
      id: `blk_inbox_${status}_${type}`,
      type: "inbox",
      content: "",
      inboxData: {
        inboxId: "ib-1",
        type,
        title: "工具审批: bash",
        content: "",
        status,
        actions: [],
      },
    }) as MessageBlock;

  const toolPending = (inboxId?: string): MessageBlock =>
    ({
      id: "blk_tc_pending",
      type: "tool_call",
      content: "",
      toolCall: {
        id: "tc-1",
        name: "bash",
        status: "running",
        pendingApproval: true,
        ...(inboxId ? { inboxId } : {}),
      },
    }) as MessageBlock;

  const awaitingAssistant = (blocks: MessageBlock[] = []) => ({
    role: "assistant",
    blocks,
    metadata: { terminationReason: "awaiting_approval" },
  });

  it("工具卡 pendingApproval ⇒ true", () => {
    expect(hasPendingApproval([{ blocks: [toolPending()] }])).toBe(true);
  });

  it("服务端合成的 pending 审批卡 ⇒ true", () => {
    expect(hasPendingApproval([{ blocks: [inbox("pending")] }])).toBe(true);
  });

  it("无卡片时回退末条 assistant 的 awaiting_approval 收尾标记", () => {
    expect(hasPendingApproval([awaitingAssistant()])).toBe(true);
  });

  it("审批卡已处理（replied）⇒ 历史收尾标记不得把状态永久挂成等待", () => {
    expect(
      hasPendingApproval([
        awaitingAssistant([inbox("replied")]),
      ]),
    ).toBe(false);
  });

  it("非审批类收件项（提问 pending）⇒ 不算等待审批", () => {
    expect(
      hasPendingApproval([{ blocks: [inbox("pending", "question")] }]),
    ).toBe(false);
  });

  it("空会话 / 普通完成消息 ⇒ false", () => {
    expect(hasPendingApproval([])).toBe(false);
    expect(
      hasPendingApproval([{ role: "assistant", metadata: { finishReason: "stop" } }]),
    ).toBe(false);
  });

  /**
   * 2026-11-17（用户实测）：界面**一直**显示「⏸ 等待审批（需要你的反馈）」，
   * 但审批面板不存在（卡片已是「已超时过期 / 已处理」）。
   *
   * 根因：`tool_call.pendingApproval` 由「awaiting_approval 占位结果」置位，
   * 审批过期/被拒后**不会再写终态结果** ⇒ 该标记永久残留；而 `hasPendingApproval`
   * 先看到它就 return true，**从不**与同 `inboxId` 的审批卡状态对账。
   */
  it("审批卡已过期 + 工具卡残留 pendingApproval（同 inboxId）⇒ false", () => {
    expect(
      hasPendingApproval([
        { role: "assistant", blocks: [toolPending("ib-1"), inbox("expired")] },
      ]),
    ).toBe(false);
  });

  it("审批卡已处理 + 工具卡残留 pendingApproval（同 inboxId）⇒ false", () => {
    expect(
      hasPendingApproval([
        { role: "assistant", blocks: [toolPending("ib-1"), inbox("replied")] },
      ]),
    ).toBe(false);
  });

  it("审批卡仍 pending + 工具卡 pendingApproval（同 inboxId）⇒ true", () => {
    expect(
      hasPendingApproval([
        { role: "assistant", blocks: [toolPending("ib-1"), inbox("pending")] },
      ]),
    ).toBe(true);
  });

  it("已处理卡的 inboxId 与工具卡不同 ⇒ 仍按工具卡等待（不误伤别的调用）", () => {
    const otherCard = {
      ...inbox("expired"),
      id: "blk_inbox_other",
      inboxData: {
        ...(inbox("expired") as { inboxData: Record<string, unknown> }).inboxData,
        inboxId: "ib-other",
      },
    } as MessageBlock;
    expect(
      hasPendingApproval([
        { role: "assistant", blocks: [toolPending("ib-1"), otherCard] },
      ]),
    ).toBe(true);
  });
});

/**
 * 2026-11-17：工具卡按 `inboxId` 对账所需的索引（收起 ⏳ 徽标 / 就地审批按钮）。
 */
describe("collectApprovalInboxIds / resolvedApprovalInboxIds（2026-11-17）", () => {
  const inboxBlock = (
    inboxId: string,
    status: "pending" | "replied" | "expired",
    type: "approval" | "question" = "approval",
  ): MessageBlock =>
    ({
      id: `blk_${inboxId}_${status}`,
      type: "inbox",
      content: "",
      inboxData: { inboxId, type, title: "x", content: "", status, actions: [] },
    }) as MessageBlock;

  it("分别收集 pending 与 resolved；非审批类（提问）忽略", () => {
    const { pending, resolved } = collectApprovalInboxIds([
      { blocks: [inboxBlock("a", "pending")] },
      { blocks: [inboxBlock("b", "expired"), inboxBlock("c", "replied")] },
      { blocks: [inboxBlock("q", "pending", "question")] },
    ]);
    expect([...pending]).toEqual(["a"]);
    expect([...resolved].sort()).toEqual(["b", "c"]);
  });

  it("同一 inboxId 既出现 pending 又出现终态 ⇒ 终态优先（不再算等待）", () => {
    const { pending, resolved } = collectApprovalInboxIds([
      { blocks: [inboxBlock("a", "pending")] },
      { blocks: [inboxBlock("a", "expired")] },
    ]);
    expect(pending.size).toBe(0);
    expect(resolved.has("a")).toBe(true);
  });

  it("resolvedApprovalInboxIds：同数组引用复用缓存，不同引用重算", () => {
    const first = [{ blocks: [inboxBlock("a", "expired")] }] as Array<{
      blocks?: MessageBlock[];
    }>;
    expect(resolvedApprovalInboxIds(first).has("a")).toBe(true);

    const second = [{ blocks: [inboxBlock("z", "replied")] }] as Array<{
      blocks?: MessageBlock[];
    }>;
    expect(resolvedApprovalInboxIds(second).has("z")).toBe(true);
    expect(resolvedApprovalInboxIds(second).has("a")).toBe(false);
  });
});

/**
 * 2026-11-24（真机 `session_mwrf18pu00456e0f2b`）：用户点「批准」后，store 里的合成块仍是
 * `pending` ⇒ 续跑期间 `hasPendingApproval` 一直判"在等审批"。本函数负责就地落定。
 */
describe("markApprovalResolvedInMessages（审批提交后即时对账）", () => {
  const inbox = (
    inboxId: string,
    status: "pending" | "replied" | "expired",
  ): MessageBlock =>
    ({
      id: `blk_${inboxId}_${status}`,
      type: "inbox",
      content: "",
      inboxData: {
        inboxId,
        type: "approval",
        title: "x",
        content: "",
        status,
        actions: [],
      },
    }) as MessageBlock;

  const toolPending = (inboxId: string): MessageBlock =>
    ({
      id: `blk_tool_${inboxId}`,
      type: "tool_call",
      content: "bash",
      toolCallId: "call-1",
      toolCall: {
        id: "call-1",
        name: "bash",
        arguments: {},
        pendingApproval: true,
        inboxId,
      },
    }) as MessageBlock;

  it("卡块 pending → replied，工具卡清掉等待标记；hasPendingApproval 立即转 false", () => {
    const messages = [
      { role: "assistant", blocks: [inbox("box-1", "pending"), toolPending("box-1")] },
    ] as Array<{ role?: string; blocks?: MessageBlock[] }>;
    expect(hasPendingApproval(messages)).toBe(true);

    const { messages: next, changed } = markApprovalResolvedInMessages(
      messages,
      "box-1",
    );
    expect(changed).toBe(true);

    const blocks = next[0].blocks ?? [];
    expect(blocks[0].inboxData?.status).toBe("replied");
    expect(blocks[1].toolCall?.pendingApproval).toBeUndefined();
    expect(blocks[1].toolCall?.inboxId).toBeUndefined();
    expect(hasPendingApproval(next)).toBe(false);
  });

  it("非目标 inboxId / 已是终态 ⇒ 不改动（避免无谓重渲染）", () => {
    const messages = [
      { role: "assistant", blocks: [inbox("box-2", "pending")] },
    ] as Array<{ role?: string; blocks?: MessageBlock[] }>;
    expect(markApprovalResolvedInMessages(messages, "other").changed).toBe(false);
    const replied = [
      { role: "assistant", blocks: [inbox("box-2", "replied")] },
    ] as Array<{ role?: string; blocks?: MessageBlock[] }>;
    expect(markApprovalResolvedInMessages(replied, "box-2").changed).toBe(false);
  });
});
