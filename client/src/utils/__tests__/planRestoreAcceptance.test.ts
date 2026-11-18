/**
 * G5-D4（2026-11-18）：**待验收**子态在前端任务卡的投影。
 *
 * 后端 `Plan.acceptance='pending'`（已执行、目标门未决）经 `mapPlanToTaskCard`
 * 进入 `TaskCardData.acceptance`，由任务卡渲染「⏸ 待验收」而不是普通执行进度。
 * 旧计划缺省该字段 ⇒ 不写字段（默认行为不变）。
 */
import { describe, it, expect } from "vitest";
import { mapPlanToTaskCard } from "../planRestore";
import type { Plan } from "@/services/planService";

function makePlan(over: Partial<Plan> = {}): Plan {
  return {
    id: "plan_acceptance_1",
    description: "交付报告",
    status: "running",
    steps: [
      {
        id: "s1",
        description: "写报告",
        status: "completed",
        retryCount: 0,
        maxRetries: 3,
      },
    ],
    ...over,
  };
}

describe("mapPlanToTaskCard — 验收子态", () => {
  it("running + acceptance=pending ⇒ 卡片 executing 且透出 pending", () => {
    const card = mapPlanToTaskCard(makePlan({ acceptance: "pending" }));
    expect(card.status).toBe("executing");
    expect(card.acceptance).toBe("pending");
  });

  it("旧计划缺省 acceptance ⇒ 不写该字段（默认行为不变）", () => {
    const card = mapPlanToTaskCard(makePlan());
    expect(card.acceptance).toBeUndefined();
  });

  it("accepted ⇒ 透出 accepted（status 仍按 running 映射）", () => {
    const card = mapPlanToTaskCard(makePlan({ acceptance: "accepted" }));
    expect(card.acceptance).toBe("accepted");
    expect(card.status).toBe("executing");
  });
});
