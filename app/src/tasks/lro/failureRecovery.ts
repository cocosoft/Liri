/**
 * lro/failureRecovery.ts — D4（2026-11-09）：失败闭环的**纯判定**
 *
 * 口径（设计稿 §2 D4）：命中**已知可恢复类**时先降级一次（换策略，不原样重跑），
 * 仍失败才进入 `terminalReceipt` 的 failed 分支，并带上原因分类。
 *
 * 只做三件纯事（零依赖，可直驱单测）：
 *   ① `classifyStepFailure`：**只读结构化字段**（`terminationReason` / `toolOutcomes`）给失败分类，
 *      不做错误文案匹配（CS02）；
 *   ② `degradationActionFor`：分类 → 既有机制的降级动作（不新增重试框架）；
 *   ③ `FAILURE_CATEGORY_LABELS`：回执展示用文案。
 *
 * 降级动作映射（全部复用既有链）：
 *   - 预算类 ⇒ `extra_attempt`（在既有 `retry` 上多给一次尝试；单次调用内的
 *     max_output 翻倍见 `TAORLoop` C1）；
 *   - 单步工具持续失败 ⇒ `replan`（既有 `recordEscalation` → 增量 replan，**降低计划粒度**）；
 *   - 供应商暂缓 ⇒ 无额外动作（`ai/policy` 的 failover 已换过供应商，走既有 retry 即可）。
 */

/** 失败分类（结构化；`unclassified` 表示未命中已知可恢复类） */
export type StepFailureCategory =
  | 'output_budget'
  | 'turn_budget'
  | 'tool_failure'
  | 'provider_deferred'
  | 'unclassified';

/** 输出预算被推理（思考）耗尽后仍未能收敛 */
const OUTPUT_BUDGET_REASONS: ReadonlySet<string> = new Set([
  'output_budget_exhausted',
]);

/** 轮次 / 总预算 / 超时类（多给一轮即可继续，不改变任务目标） */
const TURN_BUDGET_REASONS: ReadonlySet<string> = new Set([
  'max_turns',
  'budget_exhausted',
  'timeout',
]);

/**
 * 模型调用失败（供应商暂缓 / 网络中断）。
 *
 * `TAORLoop` 对模型调用异常统一以 `terminationReason='error'` 收尾（见
 * `pureDecisions.ts` 2026-11-09 注释）。供应商层的 failover 已在该调用内换过供应商，
 * 因此这里不再重复换模型，只做分类与既有 retry。
 */
const PROVIDER_REASONS: ReadonlySet<string> = new Set(['error']);

/** 已知可恢复类（命中才允许「先降级一次」） */
export const RECOVERABLE_FAILURE_CATEGORIES: ReadonlySet<StepFailureCategory> =
  new Set([
    'output_budget',
    'turn_budget',
    'tool_failure',
    'provider_deferred',
  ]);

/** 降级动作（均落在既有机制上） */
export type DegradationAction = 'extra_attempt' | 'replan';

/** 单步失败分类（只看结构化事实；证据不足 ⇒ `unclassified`，不猜） */
export function classifyStepFailure(step: {
  terminationReason?: string;
  toolOutcomes?: {
    successCount: number;
    failedCount: number;
    pendingApproval?: number;
  };
}): StepFailureCategory {
  const reason = step.terminationReason;
  if (typeof reason === 'string') {
    if (OUTPUT_BUDGET_REASONS.has(reason)) return 'output_budget';
    if (TURN_BUDGET_REASONS.has(reason)) return 'turn_budget';
    if (PROVIDER_REASONS.has(reason)) return 'provider_deferred';
    // `aborted`（循环检测 / 用户中止）与 `awaiting_approval`（等人工）不得自动降级：
    // 前者换策略也无新信息，后者由审批续跑接管。
    if (reason === 'aborted' || reason === 'awaiting_approval') {
      return 'unclassified';
    }
  }
  const outcomes = step.toolOutcomes;
  if (
    outcomes &&
    outcomes.failedCount > 0 &&
    outcomes.successCount === 0 &&
    (outcomes.pendingApproval ?? 0) === 0
  ) {
    return 'tool_failure';
  }
  return 'unclassified';
}

/** 分类 → 降级动作；`null` 表示没有可执行的降级（不消耗那一次机会） */
export function degradationActionFor(
  category: StepFailureCategory
): DegradationAction | null {
  switch (category) {
    case 'output_budget':
    case 'turn_budget':
      return 'extra_attempt';
    case 'tool_failure':
      return 'replan';
    case 'provider_deferred':
    case 'unclassified':
      return null;
  }
}

/** 「先降级一次」的账本（每任务一份；编排器持有，进程内一次） */
export interface DegradationLedger {
  used: boolean;
}

/**
 * 扣减一次降级额度：命中可恢复类且额度未用 ⇒ 返回动作并标记已用；
 * 无动作的分类（供应商层已 failover / 未归类）**不消耗**额度。
 */
export function takeOneShotDegradation(
  ledger: DegradationLedger,
  category: StepFailureCategory
): DegradationAction | null {
  if (ledger.used) return null;
  const action = degradationActionFor(category);
  if (!action) return null;
  ledger.used = true;
  return action;
}

/** 回执展示文案（缺失分类时不追加该段，不造占位） */
export const FAILURE_CATEGORY_LABELS: Record<StepFailureCategory, string> = {
  output_budget: '输出预算被推理耗尽，正文/文件内容未写完',
  turn_budget: '执行轮次/预算耗尽，未在预算内收敛',
  tool_failure: '工具调用持续失败（已降级重规划一次）',
  provider_deferred: '模型供应商暂缓/网络中断（已尝试供应商故障转移）',
  unclassified: '未归类',
};
