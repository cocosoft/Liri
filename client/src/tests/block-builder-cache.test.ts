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
