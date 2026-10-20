/**
 * U-06-2（2026-10-19）：排队模式下，输入框路径不得 abort 当前流。
 *
 * 回归点：`streamMessageImpl` 原先无条件 `prevController.abort()`，而 `ChatInput`
 * 走的就是 `streamMessage` ⇒ “消息排队”开关实际被绕过（新消息打断旧流）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamMessageImpl } from "../chat-message-stream";
import { useFeatureFlagStore } from "@/stores/featureFlags";

let prevFlags = useFeatureFlagStore.getState().flags;

beforeEach(() => {
  prevFlags = useFeatureFlagStore.getState().flags;
  useFeatureFlagStore.setState({
    flags: { ...prevFlags, message_queue: true },
  });
});

afterEach(() => {
  useFeatureFlagStore.setState({ flags: prevFlags });
});

function harness() {
  const abort = vi.fn();
  let state: Record<string, unknown> = {
    messages: [{ id: "m1", session_id: "s1", role: "user", content: "hi" }],
    pausedStreams: {},
    streamControllers: { s1: { abort } },
    editTarget: null,
    messageQueue: [],
    isStreaming: true,
    enqueueMessage: (content: string, sessionId?: string) => {
      state = {
        ...state,
        messageQueue: [
          ...((state.messageQueue as unknown[]) ?? []),
          { content, sessionId },
        ],
      };
    },
  };
  const set = (patch: Record<string, unknown>) => {
    state = { ...state, ...patch };
  };
  const get = () => state;
  return { set, get, abort };
}

describe("streamMessageImpl — 排队模式（U-06-2）", () => {
  it("本会话流式中且排队开启 ⇒ 入队并提前返回，不 abort 旧流", async () => {
    const h = harness();

    await streamMessageImpl(h.set as never, h.get as never, "next", "s1");

    expect(h.abort).not.toHaveBeenCalled();
    expect(h.get().messageQueue).toEqual([
      { content: "next", sessionId: "s1" },
    ]);
  });
});
