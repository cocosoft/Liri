/**
 * P39-b-2 · 工作项驾驶舱（嵌在运行状况页）
 *
 * 钉住：
 * ① 三个 Tab 的计数与切换（数据来自 `groups`）；
 * ② 缺样本指标显示 —（不按 0 计）；
 * ③ 一键接管成功 ⇒ 切会话并回对话页；409 ⇒ 可见的「无可接管会话」提示。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { HTTPClientError } from "../../../../services/httpClient";

const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  getHistory: vi.fn(),
  takeover: vi.fn(),
  switchSession: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: { getState: () => ({ switchSession: mocks.switchSession }) },
}));
vi.mock("../../../../services/cockpitService", () => ({
  cockpitService: {
    getSnapshot: mocks.getSnapshot,
    getHistory: mocks.getHistory,
    takeover: mocks.takeover,
  },
}));
vi.mock("../WorkItemHistory", () => ({
  default: ({ workItemId }: { workItemId: string }) => (
    <div data-testid="history">{workItemId}</div>
  ),
}));

import WorkItemCockpit from "../WorkItemCockpit";

function snapshot() {
  return {
    generatedAt: 1,
    groups: [
      {
        key: "person:answer",
        label: "待你回答",
        items: [
          {
            id: "w1",
            title: "修复 CI 失败",
            facts: { latestAssignment: { state: "running", report: "waiting" } },
            costTokens: 1200,
            lastAction: "等待授权",
            sessionId: "s1",
          },
        ],
      },
      {
        key: "working",
        label: "执行中",
        items: [
          {
            id: "w2",
            title: "实现驾驶舱面板",
            facts: { latestAssignment: { state: "running" } },
          },
        ],
      },
      {
        key: "ended",
        label: "已结束",
        items: [{ id: "w3", title: "已结束项", facts: { ended: true } }],
      },
    ],
    metrics: {
      total: 3,
      personCount: 1,
      humanInterventionRate: 1 / 3,
      endedCount: 1,
    },
    effects: { pending: 0, attempting: 1, settled: 5, failed: 0 },
  };
}

describe("WorkItemCockpit（P39-b-2）", () => {
  beforeEach(() => {
    mocks.getSnapshot.mockReset();
    mocks.getHistory.mockReset();
    mocks.takeover.mockReset();
    mocks.switchSession.mockReset().mockResolvedValue(undefined);
    mocks.navigate.mockReset();
    mocks.getSnapshot.mockResolvedValue(snapshot());
  });

  it("默认展示「待你处理」；Tab 切换显示对应分组", async () => {
    render(<WorkItemCockpit />);
    expect(await screen.findByText("修复 CI 失败")).toBeTruthy();

    fireEvent.click(screen.getByText("backgroundStatus.workItems.tabActive"));
    expect(await screen.findByText("实现驾驶舱面板")).toBeTruthy();

    fireEvent.click(screen.getByText("backgroundStatus.workItems.tabEnded"));
    expect(await screen.findByText("已结束项")).toBeTruthy();
  });

  it("缺样本指标显示 —（不把未知当 0）", async () => {
    render(<WorkItemCockpit />);
    await screen.findByText("修复 CI 失败");
    // completionRate 缺省 ⇒ 完成率显示 noSample（—）
    expect(
      screen.getByText("backgroundStatus.workItems.noSample"),
    ).toBeTruthy();
    // 投递计数有样本 ⇒ 如实显示（failed=0 是唯一可无歧义断言的数字）
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("详情按需加载完整历史", async () => {
    render(<WorkItemCockpit />);
    await screen.findByText("修复 CI 失败");

    fireEvent.click(screen.getByText("backgroundStatus.workItems.detail"));
    expect(await screen.findByTestId("history")).toBeTruthy();
  });

  it("接管成功 ⇒ 切会话并回对话页", async () => {
    mocks.takeover.mockResolvedValue({ sessionId: "s1" });
    render(<WorkItemCockpit />);
    await screen.findByText("修复 CI 失败");

    fireEvent.click(screen.getByText("backgroundStatus.workItems.takeover"));

    await waitFor(() => {
      expect(mocks.takeover).toHaveBeenCalledWith("w1");
      expect(mocks.switchSession).toHaveBeenCalledWith("s1");
      expect(mocks.navigate).toHaveBeenCalledWith("/");
    });
  });

  it("409 ⇒ 显示「无可接管会话」，不跳转", async () => {
    mocks.takeover.mockRejectedValue(new HTTPClientError("conflict", 409));
    render(<WorkItemCockpit />);
    await screen.findByText("修复 CI 失败");

    fireEvent.click(screen.getByText("backgroundStatus.workItems.takeover"));

    expect(
      await screen.findByText("backgroundStatus.workItems.takeoverNoSession"),
    ).toBeTruthy();
    expect(mocks.switchSession).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
