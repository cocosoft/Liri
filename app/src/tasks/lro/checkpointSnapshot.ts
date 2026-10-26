// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * checkpointSnapshot —— PDCA checkpoint 的**步骤快照投影**（LRO-13 顺带外移）。
 *
 * **来源**：`LongRunningTaskOrchestrator._persistCheckpoint` 内的 `steps:` 映射
 * （逐字未变）。外移理由：宿主已顶到 R04-001 的 2000 行上限，本段是纯投影、无状态。
 *
 * **字段口径（不可随意增减）**：
 * - `terminationReason`：resume 扩容判定输入；
 * - `dependsOn`：resume 按快照顺序位置映射重建依赖；
 * - `artifacts`（LRO-12）：产物台账 —— 丢失则重启后进度掉回 0；
 * - 其余为状态/结果/审查/重试的恢复映射，`lro/resumeFromCheckpoint` 逐字段回填。
 */

import type { Plan } from '../TaskOrchestrator';

/** 计划 → checkpoint `steps[]` 快照（无计划 ⇒ 空数组） */
export function projectCheckpointSteps(
  plan: Plan | undefined
): Array<Record<string, unknown>> {
  return (plan?.steps ?? []).map((s) => ({
    id: s.id,
    description: s.description,
    status: s.status,
    result: s.result,
    error: s.error,
    reviewResult: s.reviewResult,
    decision: s.decision,
    retryCount: s.retryCount,
    maxRetries: s.maxRetries,
    acceptanceCriteria: s.acceptanceCriteria,
    terminationReason: s.terminationReason,
    dependsOn: s.dependsOn,
    artifacts: s.artifacts,
  }));
}
