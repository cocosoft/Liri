// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 批次 4 / B6（2026-11-24）：`plan:task_card` 的验收子态透传与 **upsert 合并**。
 *
 * 缺口：实时广播丢弃 `acceptance`（只取 title/tasks/status），且 `upsert` 整体覆盖 ⇒
 * 「待验收」徽标只有刷新历史后才出现；后到广播缺字段还会把已有值抹掉。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { usePlanTaskStore } from "../planTaskStore";

const baseTask = {
  id: "step-1",
  name: "第一步",
  status: "pending" as const,
  dependsOn: [],
};

describe("planTaskStore.upsert（合并语义）", () => {
  beforeEach(() => {
    usePlanTaskStore.setState({ tasks: {}, pendingUpdates: {} });
  });

  it("后到广播缺 acceptance ⇒ 保留已有值（不整体覆盖）", () => {
    usePlanTaskStore.getState().upsert("plan-1", {
      title: "计划",
      tasks: [{ ...baseTask, status: "completed" }],
      status: "executing",
      acceptance: "pending",
    });

    // 后续 step 进度式广播（不带 acceptance）
    usePlanTaskStore.getState().upsert("plan-1", {
      title: "计划",
      tasks: [{ ...baseTask, status: "completed" }],
      status: "executing",
    });

    expect(usePlanTaskStore.getState().tasks["plan-1"]?.acceptance).toBe(
      "pending",
    );
  });

  it("显式给了新的 acceptance ⇒ 覆盖旧值", () => {
    usePlanTaskStore.getState().upsert("plan-2", {
      title: "计划",
      tasks: [{ ...baseTask }],
      status: "executing",
      acceptance: "pending",
    });

    usePlanTaskStore.getState().upsert("plan-2", {
      title: "计划",
      tasks: [{ ...baseTask }],
      status: "done",
      acceptance: "accepted",
    });

    expect(usePlanTaskStore.getState().tasks["plan-2"]?.acceptance).toBe(
      "accepted",
    );
    expect(usePlanTaskStore.getState().tasks["plan-2"]?.status).toBe("done");
  });
});
