/**
 * B2（2026-10-30，一致性核查 §9.4）：`useSessionRoundSummaries` 的供数契约。
 *
 * 钉住三条（"加载 26 轮不触发 26 次请求"的验收依据）：
 *  ① 同一会话的多个消费方（左侧导航 / 右侧消息摘要）**共用一次请求**；
 *  ② `roundCount` 增长（新一轮完成）才重新拉取，重复渲染不重发；
 *  ③ 端点失败 ⇒ 空数组（消费方退回"只显示已加载轮次"），不抛错。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getRoundSummaries: vi.fn(),
}));

vi.mock("../../services/sessionService", () => ({
  sessionService: { getRoundSummaries: mocks.getRoundSummaries },
}));

import {
  useSessionRoundSummaries,
  __clearSessionRoundSummariesCache,
} from "../useSessionRoundSummaries";

function summary(roundIndex: number) {
  return {
    roundIndex,
    userMsgId: `u${roundIndex}`,
    userMsg: `问题 ${roundIndex}`,
    assistantMsg: "",
    timestamp: 1_700_000_000_000 + roundIndex,
  };
}

beforeEach(() => {
  cleanup();
  __clearSessionRoundSummariesCache();
  mocks.getRoundSummaries.mockReset();
  mocks.getRoundSummaries.mockResolvedValue([summary(1), summary(2)]);
});

describe("useSessionRoundSummaries（B2）", () => {
  it("同一会话的两个消费方共用一次请求", async () => {
    const { result: rail } = renderHook(() =>
      useSessionRoundSummaries("s1", 2),
    );
    const { result: inspector } = renderHook(() =>
      useSessionRoundSummaries("s1", 2),
    );
    await waitFor(() => expect(rail.current).toHaveLength(2));
    await waitFor(() => expect(inspector.current).toHaveLength(2));
    expect(mocks.getRoundSummaries).toHaveBeenCalledTimes(1);
  });

  it("roundCount 增长 ⇒ 重新拉取并替换结果", async () => {
    const { result, rerender } = renderHook(
      ({ count }: { count: number }) => useSessionRoundSummaries("s2", count),
      { initialProps: { count: 2 } },
    );
    await waitFor(() => expect(result.current).toHaveLength(2));

    mocks.getRoundSummaries.mockResolvedValue([
      summary(1),
      summary(2),
      summary(3),
    ]);
    rerender({ count: 3 });
    await waitFor(() => expect(result.current).toHaveLength(3));
    expect(mocks.getRoundSummaries).toHaveBeenCalledTimes(2);
  });

  it("端点失败（空数组）⇒ 返回空且不抛错", async () => {
    mocks.getRoundSummaries.mockResolvedValue([]);
    const { result } = renderHook(() => useSessionRoundSummaries("s3", 1));
    await waitFor(() =>
      expect(mocks.getRoundSummaries).toHaveBeenCalledWith("s3", 200),
    );
    expect(result.current).toEqual([]);
  });

  it("无会话 id ⇒ 不发请求", () => {
    const { result } = renderHook(() => useSessionRoundSummaries(undefined));
    expect(result.current).toEqual([]);
    expect(mocks.getRoundSummaries).not.toHaveBeenCalled();
  });
});
