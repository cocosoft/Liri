// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 测试 ChronologicalBlockBuilder 增量快照缓存（P2-3）
 *
 * 验证：
 * - 数组结构变化（push/reset）时 getBlocks() 重新拷贝（返回新引用）
 * - 内容原地修改（content +=）时不触发拷贝（复用缓存引用），但内容可见性保持
 * - reset 后缓存失效
 */
import { describe, it, expect } from "vitest";
import { ChronologicalBlockBuilder } from "@/stores/chat/chat-toolcall.slice";

/**
 * 实测 chunk 序列（capture-approval-sse.mjs 捕获，真实 deepseek-v4-flash）：
 *   1. tool_completed  {pendingApproval:true, id:X}   ← 先于 tool_call 到达
 *   2. tool_call       {status:"completed", id:X}
 */
describe("审批等待态 pendingApproval 透传（J-2.2 回归）", () => {
  it("tool_completed 先于 tool_call 到达（pendingResults 暂存路径）→ 块带 pendingApproval", () => {
    const b = new ChronologicalBlockBuilder();
    const tcId = "call_00_j3BnuvvQdqgKTa7j6eck8404";

    // 1. 先到达 tool_completed（此时无 tool_call 块 → 暂存 pendingResults）
    b.updateToolCallResult(tcId, {
      status: "awaiting_approval",
      message: "需要审批",
      pendingApproval: true,
    });

    // 2. 后到达 tool_call（completed，同 id）→ 从 pendingResults 注入 pendingApproval
    b.addToolCall({
      id: tcId,
      name: "bash",
      arguments: { command: "sudo whoami" },
      status: "completed",
    });

    const blocks = b.getBlocks();
    const tcBlock = blocks.find(
      (blk) => blk.type === "tool_call" && blk.toolCall?.id === tcId,
    );
    expect(tcBlock).toBeDefined();
    expect(tcBlock!.toolCall!.pendingApproval).toBe(true);
    expect(tcBlock!.toolCall!.result).toEqual({
      success: true,
      data: {
        status: "awaiting_approval",
        message: "需要审批",
        pendingApproval: true,
      },
    });
    expect(tcBlock!.isStreaming).toBe(false);
  });

  it("tool_completed 在 tool_call 之后到达（updateToolCallResult 直写路径）→ 块带 pendingApproval", () => {
    const b = new ChronologicalBlockBuilder();
    const tcId = "call_t2";

    b.addToolCall({
      id: tcId,
      name: "bash",
      arguments: { command: "rm -rf /tmp/x" },
      status: "running",
    });
    const before = b.getBlocks();

    b.updateToolCallResult(tcId, { pendingApproval: true });

    const blocks = b.getBlocks();
    // J-2.2: updateToolCallResult 替换块对象 → 数组引用变化，memo 比较器可感知
    expect(blocks).not.toBe(before);
    const tcBlock = blocks.find(
      (blk) => blk.type === "tool_call" && blk.toolCall?.id === tcId,
    );
    expect(tcBlock!.toolCall!.pendingApproval).toBe(true);
    expect(tcBlock!.isStreaming).toBe(false);
  });

  it("后续 tool_call completed 合并 chunk 不覆盖 pendingApproval", () => {
    const b = new ChronologicalBlockBuilder();
    const tcId = "call_t3";

    b.updateToolCallResult(tcId, { pendingApproval: true });
    b.addToolCall({
      id: tcId,
      name: "bash",
      arguments: { command: "sudo whoami" },
      status: "running",
    });
    // 合并已完成 chunk（status completed，无 pendingApproval 字段）
    b.addToolCall({
      id: tcId,
      name: "bash",
      arguments: {},
      status: "completed",
      result: { success: true, data: { pendingApproval: true } },
    });

    const blocks = b.getBlocks();
    const tcBlock = blocks.find(
      (blk) => blk.type === "tool_call" && blk.toolCall?.id === tcId,
    );
    expect(tcBlock!.toolCall!.pendingApproval).toBe(true);
    expect(tcBlock!.toolCall!.status).toBe("completed");
  });
});


describe("ChronologicalBlockBuilder 增量快照缓存（P2-3）", () => {
  it("结构变化（push 新块）时 getBlocks 返回新引用", () => {
    const b = new ChronologicalBlockBuilder();
    const empty = b.getBlocks();
    expect(empty).toEqual([]);

    b.addText("hello", true);
    const afterText = b.getBlocks();
    expect(afterText).toHaveLength(1);
    expect(afterText).not.toBe(empty); // 结构变化 → 重新拷贝
  });

  it("内容原地修改（content +=）时复用缓存引用且内容可见", () => {
    const b = new ChronologicalBlockBuilder();
    b.addText("hello", true);
    const first = b.getBlocks();

    // 追加到同一 text 块（不 push，结构未变）
    b.addText(" world", true);
    const second = b.getBlocks();

    // 引用复用（缓存生效），但内容已更新
    expect(second).toBe(first);
    expect(second[0].content).toBe("hello world");
    expect(second[0].isStreaming).toBe(true);
  });

  it("思考块合并同样复用缓存", () => {
    const b = new ChronologicalBlockBuilder();
    b.addThinking("step1", true);
    const first = b.getBlocks();
    b.addThinking(" step2", true);
    const second = b.getBlocks();

    expect(second).toBe(first);
    expect(second[0].content).toBe("step1 step2");
  });

  it("新增块后缓存失效（不同结构不同引用）", () => {
    const b = new ChronologicalBlockBuilder();
    b.addText("text", true);
    const before = b.getBlocks();

    b.addStatus("🔧 running", "tool_started"); // 瞬态状态被过滤
    b.addStatus("running tool: test", undefined);
    const after = b.getBlocks();

    expect(after).not.toBe(before);
    expect(after.length).toBeGreaterThan(before.length);
  });

  it("freezeAll 只改内容不重建结构，缓存引用保持", () => {
    const b = new ChronologicalBlockBuilder();
    b.addText("final", true);
    const before = b.getBlocks();

    b.freezeAll();
    const after = b.getBlocks();

    expect(after).toBe(before);
    expect(after[0].isStreaming).toBe(false);
  });

  it("reset 后缓存失效并清空", () => {
    const b = new ChronologicalBlockBuilder();
    b.addText("old", true);
    const before = b.getBlocks();
    expect(before).toHaveLength(1);

    b.reset();
    const after = b.getBlocks();
    expect(after).toEqual([]);
    expect(after).not.toBe(before);
  });

  it("getBlocks 返回的数组与后续追加隔离（快照语义）", () => {
    const b = new ChronologicalBlockBuilder();
    b.addText("first", true);
    const snapshot = b.getBlocks(); // 快照时刻：1 块

    // 追加新块（结构变化 → 重建缓存）
    b.addStatus("second", undefined);
    const latest = b.getBlocks();

    expect(latest).toHaveLength(2);
    // 快照仍为旧数组（长度 1），不被后续修改影响
    expect(snapshot).toHaveLength(1);
  });
});
