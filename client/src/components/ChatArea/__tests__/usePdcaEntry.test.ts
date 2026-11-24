/**
 * 批次 14 P2-D（2026-11-24）：`usePdcaEntry` 的「刷新后仍可看」回归锁。
 *
 * 场景：聊天页刷新 ⇒ `orchestrationStore`（内存）为空，但消息里仍有持久化的
 * `pdca_workflow` 卡片。此时 `available` 必须为 true，且 taskId 要按会话向后端取
 * **真实**最近任务作为兜底 —— 否则消息卡的「查看详情」是点不动的死按钮。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({
  timeline: [] as {
    type: string;
    time: number;
    taskId?: string;
    sessionId?: string;
    data?: Record<string, unknown>;
  }[],
  latest: {} as Record<string, unknown>,
  sessionId: "session-p2d" as string | undefined,
  messages: [] as { id: string; blocks?: { type: string }[] }[],
}));

vi.mock("@/stores/orchestrationStore", () => ({
  useOrchestrationStore: (
    selector: (s: {
      timeline: typeof state.timeline;
      latest: typeof state.latest;
    }) => unknown,
  ) => selector({ timeline: state.timeline, latest: state.latest }),
}));

vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: (
    selector: (s: { currentSession: { id: string } | null }) => unknown,
  ) =>
    selector({
      currentSession: state.sessionId ? { id: state.sessionId } : null,
    }),
}));

vi.mock("@/stores/chat", () => ({
  useChatStore: (
    selector: (s: { messages: typeof state.messages }) => unknown,
  ) => selector({ messages: state.messages }),
}));

const latestTaskIdForSession = vi.hoisted(() =>
  vi.fn(async (): Promise<string | null> => "task-from-backend"),
);

vi.mock("@/services/planService", () => ({
  pdcaService: { latestTaskIdForSession },
}));

import { usePdcaEntry } from "../usePdcaEntry";

beforeEach(() => {
  state.timeline = [];
  state.latest = {};
  state.sessionId = "session-p2d";
  state.messages = [];
  latestTaskIdForSession.mockClear();
});

describe("usePdcaEntry — 刷新后的兜底（P2-D）", () => {
  it("有实时事件 ⇒ taskId 取自事件，不请求后端兜底", async () => {
    state.timeline = [
      {
        type: "pdca:stage:phase",
        time: 10,
        taskId: "task-live",
        sessionId: "session-p2d",
        data: {},
      },
    ];
    const { result } = renderHook(() => usePdcaEntry());
    await waitFor(() => expect(result.current.available).toBe(true));
    expect(result.current.active).toBe(true);
    expect(result.current.taskId).toBe("task-live");
    expect(latestTaskIdForSession).not.toHaveBeenCalled();
  });

  it("无事件 + 有持久化卡片 ⇒ available=true，taskId 用后端最近任务兜底", async () => {
    state.messages = [{ id: "m1", blocks: [{ type: "pdca_workflow" }] }];
    const { result } = renderHook(() => usePdcaEntry());
    await waitFor(() =>
      expect(result.current.taskId).toBe("task-from-backend"),
    );
    expect(result.current.available).toBe(true);
    // 历史卡片不得被误判成"进行中"
    expect(result.current.active).toBe(false);
    expect(latestTaskIdForSession).toHaveBeenCalledWith("session-p2d");
  });

  it("无事件 + 无卡片 ⇒ 双 false，且不请求后端", async () => {
    const { result } = renderHook(() => usePdcaEntry());
    await waitFor(() => expect(result.current.available).toBe(false));
    expect(result.current.active).toBe(false);
    expect(result.current.taskId).toBeUndefined();
    expect(latestTaskIdForSession).not.toHaveBeenCalled();
  });
});
