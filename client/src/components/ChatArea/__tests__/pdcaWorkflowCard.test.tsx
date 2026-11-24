/**
 * 批次 14（P2-A，2026-11-24）：`PdcaWorkflowCard` 的三条硬规则回归锁。
 *
 * 1. 本卡**不显示进度百分比 / 计数**（百分比只在抽屉的 `PdcaPipeline`）；
 * 2. 实时事件覆盖**只作用于该会话最后一张卡**（历史卡只渲染自己的持久化快照）；
 * 3. 「查看详情」打开抽屉（与浮动栏徽标共用同一开合态）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  // 依赖链里会 import 真实 i18n 实例 ⇒ 插件形态给最小替身（与 init() 兼容）
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

/** 消息块（本卡只读 id / type） */
const chatState = vi.hoisted(() => ({
  blocks: [] as { id: string; type: string }[],
}));

vi.mock("@/stores/chat", () => ({
  useChatStore: (
    selector: (s: {
      messages: { id: string; blocks: { id: string; type: string }[] }[];
    }) => unknown,
  ) =>
    selector({
      messages: [{ id: "m1", blocks: chatState.blocks }],
    }),
}));

vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: (
    selector: (s: { currentSession: { id: string } }) => unknown,
  ) => selector({ currentSession: { id: "session-p2a" } }),
}));

import PdcaWorkflowCard from "../PdcaWorkflowCard";
import { useOrchestrationStore } from "@/stores/orchestrationStore";
import { usePdcaDrawerStore } from "@/stores/pdcaDrawerStore";
import type { PdcaWorkflowProgressData } from "@/types/message";

const SID = "session-p2a";

const SNAP: PdcaWorkflowProgressData = {
  decision: "stage-chain",
  stage: "plan",
  status: "started",
  message: "任务已规划",
};

/** 带 percent 的进行中事件 —— 卡不得把它渲染出来 */
function phaseEvent(time: number) {
  return {
    schemaVersion: 1,
    type: "pdca:stage:phase",
    time,
    taskId: "task-p2a",
    sessionId: SID,
    data: { currentStep: "实现登录", status: "running", percent: 42 },
  };
}

beforeEach(() => {
  // 两张卡：b-old（历史）/ b-latest（最后一张）
  chatState.blocks = [
    { id: "b-old", type: "pdca_workflow" },
    { id: "b-latest", type: "pdca_workflow" },
  ];
  useOrchestrationStore.setState({
    timeline: [phaseEvent(10)],
    latest: {},
  });
  usePdcaDrawerStore.setState({ open: false });
});

describe("PdcaWorkflowCard — 摘要面（批次 14 P2-A）", () => {
  it("历史卡只渲染快照，不被最新实时事件覆盖", () => {
    render(<PdcaWorkflowCard blockId="b-old" sessionId={SID} data={SNAP} />);
    // 快照文案（mock t ⇒ 原样返回 key；标题前有 🔄 前缀，故用正则匹配）
    expect(screen.getByText(/chat\.pdcaAutoLaunched/)).toBeTruthy();
    expect(screen.getByText("chat.pdcaModeStageChain")).toBeTruthy();
    // 实时事件的主文本不出现在历史卡上（串台回归锁）
    expect(screen.queryByText("实现登录")).toBeNull();
  });

  it("最后一张卡接受实时覆盖，但不显示百分比", () => {
    const { container } = render(
      <PdcaWorkflowCard blockId="b-latest" sessionId={SID} data={SNAP} />,
    );
    expect(screen.getByText("实现登录")).toBeTruthy();
    // 硬规则 1：SSE 事件里的 percent 不在消息卡渲染（只在抽屉）
    expect(container.textContent).not.toContain("%");
  });

  it("「查看详情」打开抽屉（与浮动栏徽标共用同一开合态）", () => {
    render(<PdcaWorkflowCard blockId="b-old" sessionId={SID} data={SNAP} />);
    fireEvent.click(screen.getByText("chat.pdcaViewDetails"));
    expect(usePdcaDrawerStore.getState().open).toBe(true);
  });
});
