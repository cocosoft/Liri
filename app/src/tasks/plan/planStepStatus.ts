// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 计划步骤状态判定（纯函数）
 *
 * 抽出的原因（2026-11-14，CI 断环）：`planStartupResume`（重启续跑）与 `planImpactPreview`（影响预演）
 * 都需要这个判定，直接互相 import 会形成环（`madge --circular` 基线为 **0**，CI 会红）。
 * 依赖方向收敛为：两个消费方 → 本模块 → `TaskOrchestrator` 的状态常量（不反向依赖）。
 */

import {
  STEP_STATUS_CANCELLED,
  STEP_STATUS_COMPLETED,
  STEP_STATUS_FAILED,
} from '../TaskOrchestrator';

/** 计划中**未终态**的步骤状态判定 */
export function isNonTerminalStep(step: { status: string }): boolean {
  return (
    step.status !== STEP_STATUS_COMPLETED &&
    step.status !== STEP_STATUS_FAILED &&
    step.status !== STEP_STATUS_CANCELLED
  );
}
