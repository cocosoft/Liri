// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-04（2026-10-17）：PDCA 计划准入与停滞判定（纯函数）。
 *
 * 背景：`_runExecuteDecideLoop` 只有轮次上限，没有“计划本身是否可执行”的准入，
 * 也没有“连续 N 轮没有进展”的硬停止 ⇒ 坏计划/原地重试会一直跑到上限。
 *
 * 本模块只做纯计算，便于单测；状态落盘/生命周期由调用方负责。
 */
import type { Plan } from './TaskOrchestrator';

export const DEFAULT_MAX_PLAN_STEPS = 10;
export const DEFAULT_STALL_ROUNDS = 3;

export type PlanAdmissionResult = { ok: true } | { ok: false; reason: string };

/**
 * 计划准入：空计划、超长、空描述、依赖未知/自指/前向引用一律拒绝。
 *
 * @param plan 计划
 * @param opts.maxSteps 步骤上限（默认 10，可由调用方按环境覆盖）
 */
export function validatePlanAdmission(
  plan: Plan,
  opts: { maxSteps?: number } = {}
): PlanAdmissionResult {
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_PLAN_STEPS;
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    return { ok: false, reason: 'no-steps' };
  }
  if (plan.steps.length > maxSteps) {
    return {
      ok: false,
      reason: `too-many-steps:${plan.steps.length}>${maxSteps}`,
    };
  }

  const indexById = new Map<string, number>();
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]!;
    if (!step.description || !step.description.trim()) {
      return { ok: false, reason: `empty-step-description:${step.id}` };
    }
    indexById.set(step.id, i);
  }

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]!;
    for (const dep of step.dependsOn ?? []) {
      const depIndex = indexById.get(dep);
      if (depIndex === undefined) {
        return { ok: false, reason: `depends-on-unknown:${step.id}->${dep}` };
      }
      if (depIndex >= i) {
        return {
          ok: false,
          reason: `depends-on-self-or-forward:${step.id}->${dep}`,
        };
      }
    }
  }

  return { ok: true };
}

/**
 * 进度指纹：只取**会影响收敛判断**的字段（状态/决策/重试/结果长度/终止原因）。
 *
 * 用长度而非全文，避免长结果导致指纹计算与日志膨胀；结果内容变化但长度不变
 * 的极端情况不影响“是否停滞”的判断（下一轮状态/重试仍会变化）。
 */
export function computeProgressFingerprint(plan: Plan): string {
  return JSON.stringify({
    status: plan.status,
    stepCount: plan.steps.length,
    steps: plan.steps.map((s) => [
      s.id,
      s.status,
      s.decision ?? null,
      s.retryCount,
      s.result?.length ?? 0,
      s.terminationReason ?? null,
    ]),
  });
}

/** 连续无进展是否达到硬停止阈值。 */
export function shouldStopForStall(
  previousFingerprint: string,
  currentFingerprint: string,
  stallRounds: number,
  threshold: number = DEFAULT_STALL_ROUNDS
): boolean {
  if (currentFingerprint !== previousFingerprint) return false;
  return stallRounds >= threshold;
}
