/**
 * LRO-11（2026-10-26）：计划页「启动 PDCA」必须带 `sessionId`。
 *
 * 现状缺陷（复核取证）：`POST /v1/pdca/start` 要求 `description` + `sessionId` 必填
 * （`pdca-handlers.ts#L224-L228` 缺一即 400），而计划页此前调 `pdcaService.start(d)` 不传会话；
 * `pdcaService.start` 的 `catch` 吞掉 400 ⇒ 返回 `null` ⇒ 按钮"点了没反应"（输入被清空、无提示）。
 *
 * 本测试钉住三条契约：无会话 ⇒ 明确提示且**不发请求**；有会话 ⇒ 透传 sessionId；失败 ⇒ 可见提示。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  session: { currentSession: { id: "s-lro11" } as { id: string } | undefined },
  start: vi.fn(async (_description: string, _sessionId?: string) => "task-1"),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../stores/sessionStore", () => ({
  useSessionStore: (selector: (state: typeof mocks.session) => unknown) =>
    selector(mocks.session),
}));
vi.mock("../../../services/planService", () => ({
  pdcaService: { list: async () => [], start: mocks.start },
  planService: { list: async () => [] },
}));
vi.mock("../../Agent/PdcaPipeline", () => ({ default: () => null }));
vi.mock("../../Agent/KanbanBoard", () => ({ default: () => null }));

import PlansPage from "../PlansPage";

/** 进入「PDCA」页签（默认页签是「计划管理」） */
function openPdcaTab(): void {
  fireEvent.click(screen.getByText("plans.pdcaFlow"));
}

/** PDCA 页签首帧是加载骨架（`pdcaService.list` 异步）⇒ 等输入框出现再输入 */
async function typeDescription(text: string): Promise<void> {
  const input = await screen.findByPlaceholderText("plans.taskDescPlaceholder");
  fireEvent.change(input, { target: { value: text } });
}

describe("计划页启动 PDCA（LRO-11）", () => {
  beforeEach(() => {
    mocks.session.currentSession = { id: "s-lro11" };
    mocks.start.mockClear();
    mocks.start.mockResolvedValue("task-1");
  });

  it("有当前会话 ⇒ 启动时透传 sessionId（后端必填）", async () => {
    render(<PlansPage />);
    openPdcaTab();
    await typeDescription("把首页拆成三个模块");

    fireEvent.click(screen.getByText("plans.start"));

    await waitFor(() => {
      expect(mocks.start).toHaveBeenCalledWith("把首页拆成三个模块", "s-lro11");
    });
  });

  it("无当前会话 ⇒ 明确提示「先开会话」，且不发启动请求", async () => {
    mocks.session.currentSession = undefined;
    render(<PlansPage />);
    openPdcaTab();
    await typeDescription("把首页拆成三个模块");

    fireEvent.click(screen.getByText("plans.start"));

    expect(await screen.findByText("plans.pdcaNeedSession")).toBeTruthy();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("启动失败（后端未返回 taskId）⇒ 可见提示，不静默清空", async () => {
    mocks.start.mockResolvedValue(null);
    render(<PlansPage />);
    openPdcaTab();
    await typeDescription("把首页拆成三个模块");

    fireEvent.click(screen.getByText("plans.start"));

    expect(await screen.findByText("plans.pdcaStartFailed")).toBeTruthy();
    // 失败时不吞掉用户输入
    expect(
      (
        screen.getByPlaceholderText(
          "plans.taskDescPlaceholder",
        ) as HTMLInputElement
      ).value,
    ).toBe("把首页拆成三个模块");
  });
});
