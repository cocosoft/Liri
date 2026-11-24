// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 批次 4（2026-11-24）：面板展示常量的完整性守卫。
 *
 * 缺口：同一套词汇在两处各维护一份（`PlansPage`/`PlansPanel` 的计划状态、
 * `StatusFloatBar` 的执行阶段）⇒ 新增取值时容易只改一处。
 * 本用例锁住"每个取值都有颜色/文案键"，并验证未登记取值不加臆造。
 */
import { describe, expect, it } from "vitest";
import {
  PLAN_STATUS_STYLES,
  getPlanStatusStyle,
  type PlanStatusCode,
} from "../planStatus";
import {
  EXECUTION_PHASE_STYLES,
  getExecutionPhaseStyle,
  type ExecutionPhaseCode,
} from "../executionPhase";

const ALL_PLAN_STATUSES: PlanStatusCode[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "aborted",
];

const ALL_PHASES: ExecutionPhaseCode[] = [
  "analyzing",
  "designing",
  "implementing",
  "verifying",
  "presenting",
];

describe("planStatus 常量表", () => {
  it("每个计划状态都有圆点色 / 文本色 / 文案键", () => {
    for (const status of ALL_PLAN_STATUSES) {
      const style = PLAN_STATUS_STYLES[status];
      expect(style, `缺少计划状态样式: ${status}`).toBeDefined();
      expect(style.dotColor.length).toBeGreaterThan(0);
      expect(style.textColor.length).toBeGreaterThan(0);
      expect(style.labelKey.startsWith("plans.")).toBe(true);
    }
  });

  it("未登记取值返回 undefined（调用方回退原始值，不谎报状态）", () => {
    expect(getPlanStatusStyle("nonsense")).toBeUndefined();
    expect(getPlanStatusStyle("running")).toEqual(PLAN_STATUS_STYLES.running);
  });
});

describe("executionPhase 常量表", () => {
  it("每个执行阶段都有图标 / 文案键", () => {
    for (const phase of ALL_PHASES) {
      const style = EXECUTION_PHASE_STYLES[phase];
      expect(style, `缺少执行阶段样式: ${phase}`).toBeDefined();
      expect(style.icon.length).toBeGreaterThan(0);
      expect(style.labelKey.startsWith("chat.phase")).toBe(true);
    }
  });

  it("未登记取值返回 undefined（UI 回退显示后端原始枚举）", () => {
    expect(getExecutionPhaseStyle("nonsense")).toBeUndefined();
    expect(getExecutionPhaseStyle("analyzing")).toEqual(
      EXECUTION_PHASE_STYLES.analyzing,
    );
  });
});
