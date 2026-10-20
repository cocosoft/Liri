// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-05（2026-10-19）：加载更早消息必须复用 `setMessagesImpl` 的整表归一化。
 *
 * 回归点：原实现只按消息 id 去重后前插 ⇒ 旧页保持“多条 assistant 气泡 + 裸 tool 消息”
 * 形态，与最新页（已合并）不一致，表现为“加载更早后回复割裂”。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/types";

const mocks = vi.hoisted(() => ({
  loadConversation: vi.fn(),
}));

vi.mock("@/utils/planRestore", () => ({ restorePlanTasks: vi.fn() }));
vi.mock("../chat-history.slice", () => ({
  setSessionCache: vi.fn(),
  enqueueSaveBlocks: vi.fn(),
}));
vi.mock("@/services/sessionService", () => ({
  sessionService: { loadConversation: mocks.loadConversation },
}));

import { loadOlderMessagesImpl } from "../chat-message-actions";

const SID = "sid-u05";

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

/** 更早一页：user → assistant(含 tool_call 块) → tool 结果（裸消息） */
function olderPage(): Message[] {
  return [
    msg({ id: "u1", role: "user", content: "早先的问题", lastEventSeq: 1 }),
    msg({
      id: "a1",
      role: "assistant",
      content: "A",
      lastEventSeq: 2,
      blocks: [
        { id: "b1", type: "text", content: "A" },
        {
          id: "b2",
          type: "tool_call",
          toolCallId: "call_1",
          toolCall: { id: "call_1", name: "grep", arguments: {} },
        },
      ] as never,
    }),
    msg({
      id: "t1",
      role: "tool",
      toolCallId: "call_1",
      content: "RESULT",
      lastEventSeq: 3,
    }),
  ];
}

function harness(initial: Record<string, unknown>) {
  let state = {
    messages: [] as Message[],
    sessionFiles: [],
    hasOlder: true,
    oldestSeq: 10,
    loadingOlder: false,
    isStreaming: false,
    ...initial,
  };
  const set = (patch: Record<string, unknown>) => {
    state = { ...state, ...patch };
  };
  const get = () => state;
  return { set, get };
}

describe("loadOlderMessagesImpl — 复用整表归一化（U-05）", () => {
  beforeEach(() => {
    mocks.loadConversation.mockReset();
  });

  it("合并连续 assistant + 回填 tool 结果 + 更新分页状态", async () => {
    mocks.loadConversation.mockResolvedValue({
      messages: olderPage(),
      hasMore: true,
    });
    const current = msg({
      id: "a2",
      role: "assistant",
      content: "B",
      lastEventSeq: 4,
      blocks: [{ id: "b3", type: "text", content: "B" }] as never,
    });
    const h = harness({ messages: [current], oldestSeq: 4 });

    await loadOlderMessagesImpl(h.set as never, h.get as never);

    const messages = h.get().messages as Message[];
    // 裸 tool 消息被吸收；a1 + a2 合并为一条 assistant（不再是多个气泡）
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    const merged = messages[1];
    expect(merged.content).toContain("A");
    expect(merged.content).toContain("B");
    const toolBlock = merged.blocks?.find((b) => b.type === "tool_call");
    expect(toolBlock?.toolCall?.result).toContain("RESULT");

    expect(h.get().hasOlder).toBe(true);
    expect(h.get().oldestSeq).toBe(1);
    expect(h.get().loadingOlder).toBe(false);
  });

  it("流式进行中 ⇒ 不请求、不前插", async () => {
    const h = harness({
      messages: [msg({ id: "a2", role: "assistant", content: "B" })],
      oldestSeq: 4,
      isStreaming: true,
    });

    await loadOlderMessagesImpl(h.set as never, h.get as never);

    expect(mocks.loadConversation).not.toHaveBeenCalled();
    expect((h.get().messages as Message[]).length).toBe(1);
  });
});
