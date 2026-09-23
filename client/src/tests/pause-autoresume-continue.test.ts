/**
 * N8-1 挂起自动恢复（<30s 最短掉线场景）+ B-C1 真「继续生成」回归测试
 *
 * 守护的修复（chat-export-1786592768467.md 第二十一次修复）：
 *  1. N8-1：connectionMonitor 健康检查 10s×3 才判 DISCONNECTED，后端 5-15s 恢复时
 *     状态机从未转移 → onBackendUp 不触发 → 自动续传失效。修复为 pausedStreams
 *     非空时每 3s 轮询 /health 兜底（connectionMonitor.healthCheckOnce）。
 *  2. N8-2（伴随）：挂起时 controller 移入 pausedStreams（从全局 isStreaming 排除）。
 *  3. B-C1：continueGenerationImpl —— 以 AI 消息为引用自动发送"请继续"触发新一轮生成。
 *
 * 说明：connectionMonitor / streamPause 被 mock（store 集成测试只验证 slice 行为）；
 * connectionMonitor.healthCheckOnce 的真实 fetch 行为在 connectionMonitor.test.ts 验证。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create } from "zustand";
import type { MessageSlice } from "../stores/chat/chat-message.types";
import { createMessageSlice } from "../stores/chat/chat-message.slice";
import {
  createFileSlice,
  type FileSlice,
} from "../stores/chat/chat-file.slice";
import { continueGenerationImpl } from "../stores/chat/chat-message-actions";
import { connectionMonitor } from "../services/connectionMonitor";
import { resolveResumeWaiter } from "../services/streamPause";

vi.mock("../services/connectionMonitor", () => ({
  connectionMonitor: {
    onBackendUp: vi.fn(() => vi.fn()),
    healthCheckOnce: vi.fn(),
  },
}));
vi.mock("../services/streamPause", () => ({
  registerResumeWaiter: vi.fn(),
  resolveResumeWaiter: vi.fn(() => true),
  rejectResumeWaiter: vi.fn(),
  hasResumeWaiter: vi.fn(() => false),
}));

const mockHealthCheckOnce = vi.mocked(connectionMonitor.healthCheckOnce);
const mockResolveResumeWaiter = vi.mocked(resolveResumeWaiter);

type ChatState = MessageSlice & FileSlice;
const useTestChatStore = create<ChatState>()((...a) => ({
  ...createMessageSlice(...a),
  ...createFileSlice(...a),
}));

describe("N8-1: 挂起自动恢复（<30s 最短掉线场景轮询兜底）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockHealthCheckOnce.mockReset();
    mockResolveResumeWaiter.mockReturnValue(true);
    useTestChatStore.setState({
      pausedStreams: {},
      streamControllers: {},
      streamingStatus: "",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("挂起后健康检查恢复 → 轮询触发自动恢复（pausedStreams 清空 + controller 归还）", async () => {
    mockHealthCheckOnce.mockResolvedValue(true);
    const controller = new AbortController();
    useTestChatStore.setState({ streamControllers: { "sess-1": controller } });
    useTestChatStore.getState().pauseStream("sess-1");

    // 挂起即生效（N8-2 伴随行为）：controller 移入 pausedStreams、streamControllers 清空、状态栏文案同步
    const paused = useTestChatStore.getState().pausedStreams["sess-1"];
    expect(paused?.controller).toBe(controller);
    expect(paused?.phase).toBe("waiting");
    expect(
      useTestChatStore.getState().streamControllers["sess-1"],
    ).toBeUndefined();
    expect(useTestChatStore.getState().streamingStatus).toContain("已暂停");

    // 3s 轮询探测 → healthy → 进入 recovering 倒计时（自动恢复即将执行）
    await vi.advanceTimersByTimeAsync(3000);
    expect(useTestChatStore.getState().pausedStreams["sess-1"]?.phase).toBe(
      "recovering",
    );

    // 再 3s 倒计时 → resumeStream：pausedStreams 清空 + controller 归还 streamControllers
    await vi.advanceTimersByTimeAsync(3000);
    expect(useTestChatStore.getState().pausedStreams["sess-1"]).toBeUndefined();
    expect(useTestChatStore.getState().streamControllers["sess-1"]).toBe(
      controller,
    );
    expect(mockResolveResumeWaiter).toHaveBeenCalledWith("sess-1");
  });

  it("健康检查持续失败 → 挂起保持（不放弃、不误恢复）", async () => {
    mockHealthCheckOnce.mockResolvedValue(false);
    useTestChatStore.setState({
      streamControllers: { "sess-2": new AbortController() },
    });
    useTestChatStore.getState().pauseStream("sess-2");

    await vi.advanceTimersByTimeAsync(9000); // 多轮探测仍失败
    const paused = useTestChatStore.getState().pausedStreams["sess-2"];
    expect(paused).toBeDefined();
    expect(paused?.phase).toBe("waiting");
    expect(
      useTestChatStore.getState().streamControllers["sess-2"],
    ).toBeUndefined();
  });

  it("pausedStreams 清空后轮询自动停止（无挂起不再探测 /health）", async () => {
    mockHealthCheckOnce.mockResolvedValue(false);
    useTestChatStore.setState({
      streamControllers: { "sess-3": new AbortController() },
    });
    useTestChatStore.getState().pauseStream("sess-3");
    // 挂起后立即手动恢复（清空 pausedStreams）
    useTestChatStore.getState().resumeStream("sess-3");

    await vi.advanceTimersByTimeAsync(10000); // 首个轮询 tick 发现无挂起 → clearInterval
    expect(mockHealthCheckOnce).not.toHaveBeenCalled();
    expect(useTestChatStore.getState().pausedStreams["sess-3"]).toBeUndefined();
  });
});

describe("B-C1: continueGenerationImpl 真「继续生成」", () => {
  it("流式中忽略（不设置引用、不发送）", async () => {
    const streamMessage = vi.fn();
    const get = vi.fn(() => ({
      messages: [],
      isStreaming: true,
      streamControllers: {},
      streamMessage,
    }));
    const set = vi.fn();

    await continueGenerationImpl(set as never, get as never, "ai-1", "sess-1");

    expect(streamMessage).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("assistant 消息不存在 → return（不发送）", async () => {
    const streamMessage = vi.fn();
    const get = vi.fn(() => ({
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "hi",
          timestamp: 1,
          session_id: "sess-1",
        },
      ],
      isStreaming: false,
      streamControllers: {},
      streamMessage,
    }));
    const set = vi.fn();

    await continueGenerationImpl(set as never, get as never, "ai-1", "sess-1");

    expect(streamMessage).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("正常路径：设置 replyToId 引用 + 发送默认 prompt「请继续」", async () => {
    const streamMessage = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn(() => ({
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "hi",
          timestamp: 1,
          session_id: "sess-1",
        },
        {
          id: "ai-1",
          role: "assistant",
          content: "resp",
          timestamp: 2,
          session_id: "sess-1",
        },
      ],
      isStreaming: false,
      streamControllers: {},
      streamMessage,
    }));
    const set = vi.fn();

    await continueGenerationImpl(set as never, get as never, "ai-1");

    expect(set).toHaveBeenCalledWith({ pendingReplyToId: "ai-1" });
    expect(streamMessage).toHaveBeenCalledWith("请继续", "sess-1");
  });

  it("自定义 prompt + 显式 sessionId 优先于消息 session_id", async () => {
    const streamMessage = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn(() => ({
      messages: [
        {
          id: "ai-1",
          role: "assistant",
          content: "r",
          timestamp: 1,
          session_id: "sess-9",
        },
      ],
      isStreaming: false,
      streamControllers: {},
      streamMessage,
    }));
    const set = vi.fn();

    await continueGenerationImpl(
      set as never,
      get as never,
      "ai-1",
      "sess-2",
      "继续吧",
    );

    expect(streamMessage).toHaveBeenCalledWith("继续吧", "sess-2");
  });

  it("streamMessage 抛错 → 记录错误并复位发送状态", async () => {
    const streamMessage = vi.fn().mockRejectedValue(new Error("boom"));
    const get = vi.fn(() => ({
      messages: [
        {
          id: "ai-1",
          role: "assistant",
          content: "r",
          timestamp: 1,
          session_id: "sess-1",
        },
      ],
      isStreaming: false,
      streamControllers: {},
      streamMessage,
    }));
    const set = vi.fn();

    await continueGenerationImpl(set as never, get as never, "ai-1");

    const lastSet = set.mock.calls[set.mock.calls.length - 1][0] as Record<
      string,
      unknown
    >;
    expect(lastSet).toMatchObject({
      error: "Error: boom",
      isSending: false,
      isInputBlocked: false,
      isStreaming: false,
    });
  });
});
