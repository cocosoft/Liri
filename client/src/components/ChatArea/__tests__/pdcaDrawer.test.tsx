/**
 * 批次 14（P2-C，2026-11-24）：抽屉是**唯一进度详情来源**的回归锁。
 *
 * - 有 taskId ⇒ 渲染 `PdcaPipeline`（唯一百分比/计数来源）+ 事件流；
 * - 无 taskId ⇒ 不造假进度，如实提示"本轮无任务快照，以下为事件流"；
 * - 终态（`available=true, active=false`）点消息卡「查看详情」⇒ 抽屉仍可打开。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

/** 抽屉入口判据（由各用例覆写；模拟 `resolvePdcaEntry` 的产物） */
const entry = vi.hoisted(() => ({
  current: { active: false, available: true, taskId: "task-p2c" } as {
    active: boolean;
    available: boolean;
    taskId?: string;
  },
}));

vi.mock("../usePdcaEntry", () => ({
  usePdcaEntry: () => entry.current,
}));

vi.mock("../../Agent/PdcaPipeline", () => ({
  default: ({ taskId }: { taskId: string }) => <div>pipeline:{taskId}</div>,
}));

vi.mock("../../Agent/OrchestrationLivePanel", () => ({
  default: ({ sessionId }: { sessionId: string }) => (
    <div>live:{sessionId}</div>
  ),
}));

vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: (
    selector: (s: { currentSession: { id: string } }) => unknown,
  ) => selector({ currentSession: { id: "session-p2c" } }),
}));

vi.mock("@/stores/chat", () => ({
  useChatStore: (
    selector: (s: {
      messages: { id: string; blocks: { id: string; type: string }[] }[];
    }) => unknown,
  ) =>
    selector({
      messages: [{ id: "m1", blocks: [{ id: "b1", type: "pdca_workflow" }] }],
    }),
}));

import ChatPdcaDrawer from "../ChatPdcaDrawer";
import PdcaWorkflowCard from "../PdcaWorkflowCard";
import { usePdcaDrawerStore } from "@/stores/pdcaDrawerStore";

describe("ChatPdcaDrawer — 唯一进度详情（批次 14 P2-C）", () => {
  beforeEach(() => {
    entry.current = { active: false, available: true, taskId: "task-p2c" };
    usePdcaDrawerStore.setState({ open: true });
  });

  it("有 taskId ⇒ 标题 + 「唯一进度详情」+ 管线 + 事件流", () => {
    render(<ChatPdcaDrawer open />);
    expect(screen.getByText(/chat\.pdcaPanelTitle/)).toBeTruthy();
    expect(screen.getByText("chat.pdcaPanelSubtitle")).toBeTruthy();
    expect(screen.getByText("task-p2c")).toBeTruthy();
    expect(screen.getByText("pipeline:task-p2c")).toBeTruthy();
    expect(screen.getByText("live:session-p2c")).toBeTruthy();
    expect(screen.queryByText("chat.pdcaNoTaskSnapshot")).toBeNull();
  });

  it("无 taskId ⇒ 不渲染管线，如实提示只看事件流", () => {
    entry.current = { active: false, available: true };
    render(<ChatPdcaDrawer open />);
    expect(screen.queryByText(/^pipeline:/)).toBeNull();
    expect(screen.getByText("chat.pdcaNoTaskSnapshot")).toBeTruthy();
    expect(screen.getByText("live:session-p2c")).toBeTruthy();
  });

  it("未展开 / 无 PDCA ⇒ 不渲染", () => {
    const { container, rerender } = render(<ChatPdcaDrawer open={false} />);
    expect(container.textContent).toBe("");
    rerender(<ChatPdcaDrawer open />);
    expect(container.textContent).not.toBe("");
    entry.current = { active: false, available: false };
    rerender(<ChatPdcaDrawer open />);
    expect(container.textContent).toBe("");
  });

  it("终态点消息卡「查看详情」⇒ 同一开合态驱动抽屉出现", () => {
    usePdcaDrawerStore.setState({ open: false });
    function Harness() {
      const open = usePdcaDrawerStore((s) => s.open);
      return (
        <>
          <PdcaWorkflowCard
            blockId="b1"
            sessionId="session-p2c"
            data={{
              decision: "stage-chain",
              stage: "plan",
              status: "completed",
              message: "本轮已结束",
            }}
          />
          <ChatPdcaDrawer open={open} />
        </>
      );
    }
    render(<Harness />);
    expect(screen.queryByText(/chat\.pdcaPanelTitle/)).toBeNull();
    fireEvent.click(screen.getByText("chat.pdcaViewDetails"));
    expect(screen.getByText(/chat\.pdcaPanelTitle/)).toBeTruthy();
    expect(screen.getByText("pipeline:task-p2c")).toBeTruthy();
  });
});
