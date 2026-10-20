// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-05 残余（2026-10-19）：事件驱动刷新必须是**增量合并**。
 *
 * 回归点：`refreshSessionIfActive` 原走 `loadMessages`（整表替换 latest page）⇒
 * 已加载的更早历史被丢弃、`oldestSeq` 与新列表错位（点「加载更早」出现空档）。
 */
import { describe, expect, it } from "vitest";
import { create } from "zustand";
import type { Message } from "@/types";
import type { MessageSlice } from "../chat-message.types";
import { createMessageSlice } from "../chat-message.slice";
import { createFileSlice, type FileSlice } from "../chat-file.slice";

type ChatState = MessageSlice & FileSlice;
const useTestChatStore = create<ChatState>()((...a) => ({
  ...createMessageSlice(...a),
  ...createFileSlice(...a),
}));

function msg(
  id: string,
  role: Message["role"],
  content: string,
  seq: number,
): Message {
  return {
    id,
    role,
    content,
    timestamp: seq,
    session_id: "s-merge",
    lastEventSeq: seq,
  } as Message;
}

describe("mergeRefreshedMessages — 增量刷新（U-05 残余）", () => {
  it("保留已加载的更早历史与分页游标，只追加刷新结果", () => {
    const older = msg("u1", "user", "早先问题", 1);
    const olderReply = msg("a1", "assistant", "早先回答", 2);
    useTestChatStore.setState({
      messages: [older, olderReply],
      hasOlder: true,
      oldestSeq: 1,
    });

    useTestChatStore
      .getState()
      .mergeRefreshedMessages([msg("a2", "assistant", "续跑结果", 3)]);

    const state = useTestChatStore.getState();
    // 连续 assistant 按整表归一化合并为一条（与首次加载口径一致），内容两段都在
    expect(state.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(state.messages[1].content).toContain("续跑结果");
    // 分页状态不得被增量刷新重置
    expect(state.hasOlder).toBe(true);
    expect(state.oldestSeq).toBe(1);
  });

  it("当前列表为空 ⇒ 等价整表加载（首屏/空会话刷新）", () => {
    useTestChatStore.setState({
      messages: [],
      hasOlder: false,
      oldestSeq: null,
    });

    useTestChatStore
      .getState()
      .mergeRefreshedMessages([msg("a1", "assistant", "历史", 1)]);

    expect(useTestChatStore.getState().messages.map((m) => m.id)).toEqual([
      "a1",
    ]);
  });
});
