// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * GoalDeviation — 目标**偏差判定**（T-②02，2026-10-03）
 *
 * 规格：`.trae/specs/goal-metrics-closure.md`（台账 T-②02 / 原始出处 `architecture-benchmark-20260928.md` §6.4 #11）。
 *
 * **问题**：goal 的**预算触顶**半边已闭环（`goalBudget.chargeGoalUsage` + `goal/status_changed` +
 * 收尾指令），**进度/偏差**半边没有出口 —— `queryStageMetrics` / `queryReviewSamples`
 * 有实现却零消费。本模块补上"偏差"的**判定**半边，接线（查询 → 判定 → 落事件）在
 * `LongRunningTaskOrchestrator` 的 PDCA 终态收口点。
 *
 * **判据（Q1② 裁定：turn 预算消耗速率）**：`ratio = actual(实际 turn) / expected(turn 预算)`。
 * 阈值**零新增常量** —— 复用既有统一预算阈值 `UNIFIED_THRESHOLDS`
 * （`WARNING = 0.75` / `CRITICAL = 0.92`，与 `BudgetPolicy` 的 ratio→status 同一分层）。
 *
 * **纯函数、无 IO、无副作用**（R06-006 GR03：判定与接线分离）—— 阈值与边界可独立单测，
 * 对齐 `BudgetPolicy.evaluateGoalBudget` 的做法（P2-10）。
 * 本模块**不**读库、**不**落事件、**不**改 goal 状态机（偏差 ≠ 状态迁移）。
 */

import { UNIFIED_THRESHOLDS } from '@modules/tokenBudget';
import type { GoalDeviationSeverity } from '@modules/types/goal';

/** 一条 stage 的 turn 预算消耗样本（调用方从 `goal_metrics` 行派生，本模块不依赖其类型） */
export interface StageTurnSample {
  /** 阶段标识（`goal_metrics.stage_id`） */
  stage: string;
  /**
   * 该阶段的 turn 预算（`goal_metrics.max_turns`）。
   * `null` / 非有限 / `<= 0` ⇒ **无预算** ⇒ 不判定（不臆造分母，CS04）。
   */
  expected: number | null;
  /** 实际消耗的 turn（`goal_metrics.total_turns`） */
  actual: number;
}

/** 一条偏差发现（越过阈值才产出） */
export interface GoalDeviationFinding {
  stage: string;
  expected: number;
  actual: number;
  /** 消耗速率 `actual / expected`（> 1 表示超出预算） */
  ratio: number;
  severity: GoalDeviationSeverity;
}

/**
 * 判定偏差：对**有预算**的样本计算消耗速率，`ratio ≥ WARNING` 才产出发现。
 *
 * 边界口径：
 * - 无预算（`expected` 为 `null` / 非有限 / `<= 0`）⇒ 跳过（不能算速率）；
 * - `actual` 非有限 ⇒ 跳过（数据异常不臆测）；
 * - `ratio < WARNING` ⇒ 不产出（正常范围不告警）；
 * - `ratio ≥ CRITICAL` ⇒ `critical`，否则 `warning`。
 */
export function evaluateGoalDeviation(
  samples: readonly StageTurnSample[]
): GoalDeviationFinding[] {
  const findings: GoalDeviationFinding[] = [];
  for (const sample of samples) {
    const { expected, actual } = sample;
    if (expected === null || !Number.isFinite(expected) || expected <= 0)
      continue;
    if (!Number.isFinite(actual)) continue;
    const ratio = actual / expected;
    if (ratio < UNIFIED_THRESHOLDS.WARNING) continue;
    findings.push({
      stage: sample.stage,
      expected,
      actual,
      ratio,
      severity: ratio >= UNIFIED_THRESHOLDS.CRITICAL ? 'critical' : 'warning',
    });
  }
  return findings;
}
