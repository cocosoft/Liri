/**
 * PhaseVocabulary — 阶段词汇表唯一真源（架构归一，第八节 B1-B6）
 *
 * 跨模块共享的阶段枚举必须在此单一导出；重复定义处只允许 re-export 或显式转换函数。
 *
 * 两条正交语义族：
 *   1. 意图族 plan/do/check/act（本文件）：隐式意图识别（ImplicitEngineHook）+
 *      规范 PDCA 英文名 / 模型路由（modelRouter / ProjectItemStore）。
 *      B6：ImplicitIntent 与意图阶段间此前无映射层，经 toPdcaPhase() 显式转换。
 *   2. 编排族 plan/execute/review/decide（任务编排 + checkpoint 落盘）——见
 *      LongRunningTaskOrchestrator 与 PdcaWorkItemBridge（与本族正交，不在本文件）。
 */

/** 规范 PDCA 英文名（S3 ModelPhaseRouter 阶段、项目条目 phase、隐式意图去 none 后） */
export type PdcaIntent = 'plan' | 'do' | 'check' | 'act';

/** 隐式意图识别：在 PdcaIntent 上追加 'none' 表示「非 PDCA 意图」 */
export type ImplicitIntent = PdcaIntent | 'none';

/**
 * B6：隐式意图 → 意图阶段 的显式转换函数。
 * 'none' → undefined（无可用 PDCA 意图）；其余同值映射。
 */
export function toPdcaPhase(intent: ImplicitIntent): PdcaIntent | undefined {
  return intent === 'none' ? undefined : intent;
}

// ── 编排族（B4：任务编排 + checkpoint 落盘）──────────────────────────────────

/**
 * 编排族阶段（LongRunningTaskOrchestrator 与 PdcaWorkItemBridge 共用单一真源）。
 * 保留既有全部取值（含 plan_pending / stage_awaiting_approval / abort），
 * 仅收敛重复定义；新增/删取值必须在此一次性完成，勿在消费方另起类型。
 *
 * 与原两处本地定义的关系：
 *   - LongRunningTaskOrchestrator 此前缺 abort/failed（从未赋值，仅写 checkpoint 文件），
 *     此处向上取并集，行为不变；
 *   - PdcaWorkItemBridge 此前含全部取值，与本类型一致，仅改为从本处 re-export。
 */
export type PdcaPhase =
  | 'plan'
  | 'plan_pending'
  | 'execute'
  | 'review'
  | 'decide'
  | 'completed'
  | 'abort'
  | 'failed'
  /** D1（M7，2026-08-13）：阶段审批挂起（区别于 plan_pending，阶段产物待审批） */
  | 'stage_awaiting_approval';

/** WorkItem 状态（源自 PdcaWorkItemBridge，与 PdcaPhase 派生映射同址） */
export type WorkItemStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'review'
  | 'done'
  | 'failed';

/**
 * Gap D（1-0b，2026-09-03）：phase → checkpoint.status 联动映射
 * （原 LongRunningTaskOrchestrator.pdcaCheckpointStatus）。
 * findExistingTask（排除 abort/failed/completed）与 scanAndAbortStalePdcaTasks
 * （命中 started/running）都依赖 checkpoint.status 的完整生命周期演进；
 * 仅做字段 merge 而 status 停在初始 'started' 时，幂等排除依然永假。
 */
export function pdcaCheckpointStatus(
  phase: PdcaPhase
): 'started' | 'running' | 'completed' {
  switch (phase) {
    case 'completed':
    case 'abort':
    case 'failed':
      return 'completed';
    case 'execute':
    case 'review':
    case 'decide':
      return 'running';
    default:
      // plan / plan_pending / stage_awaiting_approval
      return 'started';
  }
}

/** phase → WorkItem.status 派生映射（原 PdcaWorkItemBridge.PDCA_TO_WORKITEM） */
export const PDCA_TO_WORKITEM: Record<PdcaPhase, WorkItemStatus> = {
  plan: 'pending',
  plan_pending: 'review',
  stage_awaiting_approval: 'review',
  execute: 'running',
  review: 'review',
  decide: 'running',
  completed: 'done',
  abort: 'failed',
  failed: 'failed',
};

/** P0(M9)：PDCA 终态阶段（list 时过滤掉） */
export const PDCA_TERMINAL_PHASES = new Set(['completed', 'failed', 'abort']);
