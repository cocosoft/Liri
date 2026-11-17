/**
 * attachStreamImpl 单测（2026-11-18，Spec `.trae/specs/stream-attach.md` §6）
 *
 * 锁死"接入"的三条边界：
 * 1. 只读：不动 `isSending`、不发送消息；只登记 controller/isStreaming；
 * 2. 状态类 chunk 写既有字段（streamingStatus / executionPhase）；
 * 3. 结束/失败都以**服务端落盘**为正文唯一来源（拉一次消息做增量刷新），
 *    失败时同时把错误如实暴露，不假装接上了。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChunk } from "@/services/chatService";

const mocks = vi.hoisted(() => ({
  attachStream: vi.fn(),
  getMessages: vi.fn(),
}));

vi.mock("@/services/chatService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/chatService")>();
  return {
    ...actual,
    chatService: { ...actual.chatService, attachStream: mocks.attachStream },
  };
});

vi.mock("@/services/sessionService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/sessionService")>();
  return {
    ...actual,
    sessionService: {
      ...actual.sessionService,
      getMessages: mocks.getMessages,
    },
  };
});

import { attachStreamImpl } from "../chat-message-actions";

const SID = "s_attach";

function harness() {
  let state: Record<string, unknown> = {
    messages: [{ id: "a1", session_id: SID, role: "assistant", content: "" }],
    streamControllers: {},
    pausedStreams: {},
    isStreaming: false,
    isSending: false,
    activeStreamSessionId: null,
    streamingStatus: "",
    executionPhase: null,
    error: null,
    errorCode: null,
    mergeRefreshedMessages: vi.fn(),
  };
  const set = (patch: Record<string, unknown>) => {
    state = { ...state, ...patch };
  };
  const get = () => state;
  return { set, get };
}

async function* chunks(...items: StreamChunk[]) {
  for (const item of items) yield item;
}

beforeEach(() => {
  mocks.attachStream.mockReset();
  mocks.getMessages.mockReset();
  mocks.getMessages.mockResolvedValue([
    { id: "a1", session_id: SID, role: "assistant", content: "最终正文" },
  ]);
});

describe("attachStreamImpl", () => {
  it("状态 chunk 写既有字段；结束时清理运行态并按落盘刷新", async () => {
    mocks.attachStream.mockReturnValue(
      chunks(
        { type: "status", content: "工具执行中" } as StreamChunk,
        { type: "done", content: "" } as StreamChunk,
      ),
    );
    const h = harness();

    await attachStreamImpl(h.set as never, h.get as never, SID);

    expect(h.get().isStreaming).toBe(false);
    expect(h.get().streamingStatus).toBe("");
    expect(h.get().streamControllers).toEqual({});
    expect(h.get().activeStreamSessionId).toBeNull();
    // 正文唯一来源 = 服务端落盘
    expect(h.get().mergeRefreshedMessages).toHaveBeenCalledWith([
      { id: "a1", session_id: SID, role: "assistant", content: "最终正文" },
    ]);
  });

  it("失败 chunk（404/409）⇒ 如实置错，仍刷新落盘内容", async () => {
    mocks.attachStream.mockReturnValue(
      chunks({
        type: "error",
        content: "本轮已结束（或超出接入窗口），已刷新为落盘内容",
        errorCode: "ATTACH_NO_ACTIVE_RUN",
      } as StreamChunk),
    );
    const h = harness();

    await attachStreamImpl(h.set as never, h.get as never, SID);

    expect(h.get().errorCode).toBe("ATTACH_NO_ACTIVE_RUN");
    expect(h.get().isStreaming).toBe(false);
    expect(h.get().mergeRefreshedMessages).toHaveBeenCalledTimes(1);
  });

  it("本会话已有本地流 ⇒ 不重复接入（不调用 attachStream）", async () => {
    const h = harness();
    h.set({
      streamControllers: { [SID]: new AbortController() },
      isStreaming: true,
    });

    await attachStreamImpl(h.set as never, h.get as never, SID);

    expect(mocks.attachStream).not.toHaveBeenCalled();
    expect(h.get().isStreaming).toBe(true);
  });

  it("接入不触碰 isSending（只读，不伪装成发送）", async () => {
    const h = harness();
    const seenSending: boolean[] = [];
    mocks.attachStream.mockImplementation(async function* () {
      seenSending.push(Boolean(h.get().isSending));
      yield { type: "status", content: "x" } as StreamChunk;
    });

    await attachStreamImpl(h.set as never, h.get as never, SID);

    expect(seenSending).toEqual([false]);
    expect(h.get().isSending).toBe(false);
  });
});
