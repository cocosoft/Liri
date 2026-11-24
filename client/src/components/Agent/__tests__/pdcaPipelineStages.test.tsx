/**
 * P2-F（2026-11-24）：阶段链任务在抽屉里必须渲染 `stages` 列表，
 * 而不是「该任务无步骤快照」空态（真机 `pdca_mwupjxor`）。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../services/httpClient", () => ({
  httpLegacy: { post: vi.fn(async () => ({ ok: true })) },
}));

const status = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
}));

vi.mock("@/services/planService", () => ({
  pdcaService: {
    getStatus: async () => status.value,
  },
}));

import PdcaPipeline from "../PdcaPipeline";

describe("PdcaPipeline — 阶段链视图（P2-F）", () => {
  it("无 plan 但有 stages ⇒ 渲染阶段列表 + 待审批标记，不显示空态", async () => {
    status.value = {
      taskId: "pdca_stage_chain",
      planId: "",
      phase: "execute",
      description: "阶段链任务",
      status: "started",
      source: "checkpoint",
      currentStage: "design",
      stages: [
        { id: "requirement", status: "completed" },
        { id: "design", status: "running", approvalInboxId: "inbox_1" },
        { id: "delivery", status: "pending" },
      ],
    };

    render(<PdcaPipeline taskId="pdca_stage_chain" />);

    await waitFor(() => {
      expect(screen.getByText("agent.stageChain")).toBeTruthy();
    });
    // 阶段 id 原样展示（配置驱动，不做硬编码映射）
    expect(screen.getByText("requirement")).toBeTruthy();
    expect(screen.getByText("design")).toBeTruthy();
    expect(screen.getByText("delivery")).toBeTruthy();
    // 审批门标记
    expect(screen.getByText("agent.stageAwaitingApproval")).toBeTruthy();
    // 关键回归：不得再显示"无步骤快照"
    expect(screen.queryByText("agent.noStepSnapshot")).toBeNull();
  });
});
