// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 测试 processChunk thinking 预算上限（P0-2，2026-08-15）
 *
 * 背景：对话排查发现模型可输出数万字 thinking 收尾（无 text 正文），
 * thinking 无预算上限会直接进 store/messages.jsonl，下次作为上下文重发
 * （上下文爆炸）。本测试验证：
 * - 未超限：thinking 正常进入 blocks
 * - 超限：累计超过 MAX_THINKING_CHARS 后截断，不再进 blocks
 * - 截断告警：仅首次超限记录一次 warn（truncated 标志）
 *
 * M4 更新（2026-08-xx）：渲染源从 ChronologicalBlockBuilder 切换为
 * EventBasedStreamAggregator → deriveMessages 纯函数派生，本测试同步
 * 改为从 aggregator 取 blocks 验证（与真实渲染路径一致）。
 */
import { describe, it, expect } from "vitest";
import {
  processChunk,
  MAX_THINKING_CHARS,
  type ProcessChunkContext,
} from "@/stores/chat/chat-stream-chunk";
import { EventBasedStreamAggregator } from "@/stores/chat/streaming/EventBasedStreamAggregator";
import type { Message, MessageBlock } from "@/types";

function buildContext(overrides?: { messages?: Message[] }): {
  ctx: ProcessChunkContext;
  getMessages: () => Message[];
} {
  const assistantId = "assistant_test";
  let messages: Message[] = overrides?.messages ?? [
    {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      session_id: "session_test",
    },
  ];
  const getMessages = () => messages;

  // M4：使用 EventBasedStreamAggregator（真实渲染源）替代 ChronologicalBlockBuilder
  const aggregator = new EventBasedStreamAggregator();
  aggregator.init([], "session_test", { assistantMessageId: assistantId });

  const batch = { version: 0, pending: false, latestMessages: null };
  const ctx: ProcessChunkContext = {
    sid: "session_test",
    sessionId: "session_test",
    assistantId,
    controller: new AbortController(),
    saveQueue: {
      enqueue: () => {},
      flush: () => Promise.resolve(),
    } as unknown as ProcessChunkContext["saveQueue"],
    lastChunkTimeRef: { current: Date.now() },
    batch,
    flushSet: () => {},
    set: (partial: unknown) => {
      // 仅维护 messages 字段（测试只需验证 blocks 累积）
      const p = partial as { messages?: Message[] };
      if (p.messages) messages = p.messages;
    },
    get: () => ({ messages }) as never,
    thinkingCharsRef: { current: 0, truncated: false },
    aggregator,
  };
  return { ctx, getMessages };
}

/** M4 工具：从 aggregator 派生本流 assistant 的 blocks（与真实渲染链路一致） */
function getDerivedBlocks(ctx: ProcessChunkContext): MessageBlock[] {
  const derived = ctx.aggregator.deriveMessages();
  const assistantMsg = derived.find((m) => m.id === ctx.assistantId);
  return assistantMsg?.blocks ?? [];
}

describe("processChunk thinking 预算上限（P0-2）", () => {
  it("未超限：thinking 正常进入 blocks", async () => {
    const { ctx } = buildContext();
    await processChunk(ctx, { type: "thinking", content: "思考内容" });
    const blocks = getDerivedBlocks(ctx);
    expect(blocks.filter((b) => b.type === "thinking")).toHaveLength(1);
    expect(ctx.thinkingCharsRef.current).toBe("思考内容".length);
    expect(ctx.thinkingCharsRef.truncated).toBe(false);
  });

  it("累计跨过边界：只保留剩余预算部分并置 truncated", async () => {
    const { ctx } = buildContext();
    const keepLen = MAX_THINKING_CHARS - 100;
    // 先推 100 字符，再推一个超过剩余预算的大 chunk
    await processChunk(ctx, {
      type: "thinking",
      content: "x".repeat(100),
    });
    await processChunk(ctx, {
      type: "thinking",
      content: "y".repeat(MAX_THINKING_CHARS),
    });
    const blocks = getDerivedBlocks(ctx);
    const thinkingText = blocks
      .filter((b) => b.type === "thinking")
      .map((b) => b.content)
      .join("");
    // 总长度 = MAX（保留部分）+ 不超出的部分
    expect(thinkingText.length).toBe(MAX_THINKING_CHARS);
    // 截断后的内容以 x 开头（先推的 100 字符保留），y 只保留剩余部分
    expect(thinkingText.startsWith("x".repeat(100))).toBe(true);
    expect(thinkingText.endsWith("y".repeat(keepLen))).toBe(true);
    expect(ctx.thinkingCharsRef.truncated).toBe(true);
  });

  it("已超限：后续 thinking 全部丢弃，不再进 blocks", async () => {
    const { ctx } = buildContext();
    ctx.thinkingCharsRef.current = MAX_THINKING_CHARS;
    ctx.thinkingCharsRef.truncated = true;
    await processChunk(ctx, {
      type: "thinking",
      content: "z".repeat(1000),
    });
    const blocks = getDerivedBlocks(ctx);
    // 预状态是"已截断 + 无事件写入" → 派生出的 blocks 应该没有 thinking 块
    // （测试初始 aggregator 为空，所以 blocks 为空数组）
    expect(blocks.filter((b) => b.type === "thinking")).toHaveLength(0);
    expect(ctx.thinkingCharsRef.current).toBe(MAX_THINKING_CHARS + 1000);
  });
});
