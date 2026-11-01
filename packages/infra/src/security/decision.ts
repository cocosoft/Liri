/**
 * 统一安全决策词汇（P0-3 · `security-decision-verdict.md`）
 *
 * 背景：本仓安全决策此前有**多套异构表示**（`SecurityBehavior='allow'|'deny'|'ask'` ·
 * `requireApproval` 布尔 · `CodeRunStatus`），且深扫不可用时存在
 * `INDETERMINATE → ALLOW` 的**隐性折叠**。本模块提供**单一四态词汇**与**单调合并**，
 * 使"不确定"可被显式表达、且**永不被折算为放行**。
 *
 * 边界（CS03）：本版**不做**全仓 `SecurityBehavior` 的破坏性迁移 —— 仅新增统一词汇
 * 与**纯函数映射**；旧表示保持不变，调用方可按需采用。
 */

import type { SecurityBehavior } from './types';

/**
 * 统一安全决策结果（**四态**）。
 *
 * ⚠️ 四态**不得折叠为布尔** —— 尤其 `INDETERMINATE` 不得被折算为 `ALLOW`
 * （那正是本模块要消除的 fail-open 盲区）。
 */
export type SecurityVerdict =
  | 'ALLOW' // 通过当前层检查
  | 'DENY' // 明确拒绝
  | 'REQUIRE_REVIEW' // 需人工审批
  | 'INDETERMINATE'; // 当前层无法给出可靠结论

/** 全部合法取值（遍历/校验用，避免散落字面量） */
export const SECURITY_VERDICTS: readonly SecurityVerdict[] = [
  'ALLOW',
  'DENY',
  'REQUIRE_REVIEW',
  'INDETERMINATE',
];

/**
 * 深度扫描（码执行静态校验的 SWC 原生扫描等）的执行状态。
 *
 * - `ran`：扫描已执行（无论有无命中）；
 * - `skipped`：扫描**未执行**（原生模块缺失 / 平台不可用）—— ≠ 扫描通过；
 * - `failed`：扫描**执行失败**（解析错误 / 抛错）。
 */
export type DeepScanStatus = 'ran' | 'skipped' | 'failed';

/** 严格度序（数值越大越严格）；用于多层合并**取最严** */
const STRICTNESS: Readonly<Record<SecurityVerdict, number>> = {
  ALLOW: 0,
  INDETERMINATE: 1,
  REQUIRE_REVIEW: 2,
  DENY: 3,
};

/** 既有三态 `SecurityBehavior` → 统一四态（`allow/deny/ask` 均有确定语义，不产生 `INDETERMINATE`） */
export function verdictFromBehavior(
  behavior: SecurityBehavior
): SecurityVerdict {
  switch (behavior) {
    case 'allow':
      return 'ALLOW';
    case 'deny':
      return 'DENY';
    case 'ask':
      return 'REQUIRE_REVIEW';
  }
}

/**
 * 多层裁决合并：**取最严**（`DENY > REQUIRE_REVIEW > INDETERMINATE > ALLOW`）。
 *
 * 单调性：合并结果**只会比输入更严或相等**，**绝不放宽**任何一层的结论。
 * 空输入 ⇒ `INDETERMINATE`（**保守**，而非 `ALLOW` —— 无结论 ≠ 放行）。
 */
export function combineVerdicts(
  verdicts: readonly SecurityVerdict[]
): SecurityVerdict {
  if (verdicts.length === 0) return 'INDETERMINATE';
  return verdicts.reduce<SecurityVerdict>(
    (acc, v) => (STRICTNESS[v] > STRICTNESS[acc] ? v : acc),
    'ALLOW'
  );
}

/** 是否放行 —— **仅** `ALLOW` 为真（`INDETERMINATE`/`REQUIRE_REVIEW`/`DENY` 一律为假） */
export function isPermissive(verdict: SecurityVerdict): boolean {
  return verdict === 'ALLOW';
}

/**
 * 深度扫描状态 → 统一裁决。
 *
 * - `ran` ⇒ `ALLOW`（**唯一**可放行分支）；
 * - `skipped` / `failed` ⇒ `INDETERMINATE`（默认姿态）或 `REQUIRE_REVIEW`（`strict`）——
 *   **两者都不等于放行**；由入口策略决定最终处置（收紧则拒绝/转审批）。
 */
export function verdictFromScanStatus(
  status: DeepScanStatus,
  strict: boolean
): SecurityVerdict {
  if (status === 'ran') return 'ALLOW';
  return strict ? 'REQUIRE_REVIEW' : 'INDETERMINATE';
}
