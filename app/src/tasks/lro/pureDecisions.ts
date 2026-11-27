/**
 * lro/pureDecisions.ts — PDCA resume 扩容续跑的纯函数判定
 *
 * 由 `tasks/LongRunningTaskOrchestrator.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §46）：**只搬不改**（含原注释）。
 * 零宿主依赖 ⇒ 无循环；公开面由宿主 **re-export** 保持。
 */

import { TaskStatus } from '@openliri/kernel/taskStatus';

/**
 * D4（2026-11-09）：**预算类**终止原因 —— 扩容续跑可救（多给一轮即可继续）。
 *
 * 原集合只有 `max_turns`；真机 N-13 形态「输出预算被推理耗尽」
 * （`output_budget_exhausted`）同样是"没写完、可接着写"，一并纳入。
 */
const TURNS_EXTENSION_REASONS: ReadonlySet<string> = new Set([
  'max_turns',
  'budget_exhausted',
  'output_budget_exhausted',
  'timeout',
]);

/**
 * B-任务（2026-09-05）：预算类扩容续跑判定（纯函数，可单测）。
 * steps 含预算类终止步骤且续跑次数未达上限 → 本轮放大轮次预算（×2）并计数+1。
 */
export function planTurnsExtensionDecision(
  steps: Array<{ terminationReason?: string }>,
  currentExtensions: number,
  limit: number
): { apply: boolean; multiplier: number; count: number } {
  const candidates = steps.filter(
    (s) =>
      typeof s.terminationReason === 'string' &&
      TURNS_EXTENSION_REASONS.has(s.terminationReason)
  ).length;
  if (candidates > 0 && currentExtensions < limit) {
    return { apply: true, multiplier: 2, count: currentExtensions + 1 };
  }
  return { apply: false, multiplier: 1, count: currentExtensions };
}

/** 扩容激活时，预算类终止的步骤置回 pending 重跑（`aborted` / `loop_detected` 拒绝） */
export function shouldReRollExtendedStep(
  multiplierActive: boolean,
  terminationReason?: string
): boolean {
  return (
    multiplierActive &&
    typeof terminationReason === 'string' &&
    TURNS_EXTENSION_REASONS.has(terminationReason)
  );
}

/**
 * U-02（2026-10-19）：终止原因是否表示「预算耗尽但未收敛」。
 *
 * 这类步骤**不得**记为 completed（否则 review 只审 completed 步骤、目标门也可能
 * 看到"步骤全过"而形成假完成）；应落 failed 并保留 terminationReason，
 * 供 resume 扩容续跑 / 目标级评估使用。
 */
const NON_CONVERGED_TERMINATION_REASONS = new Set([
  'max_turns',
  'timeout',
  'budget_exhausted',
  /**
   * D4（2026-11-09）：输出预算被推理耗尽（N-13，`finishReason=output_budget_exhausted`）。
   *
   * 此前该原因**不在本集合** ⇒ 步骤被记为 `completed`（假完成），review 只审 completed
   * 步骤、目标门也可能看到"步骤全过"，而正文/文件内容其实没写完。与 `max_turns`
   * 同属"预算耗尽但未收敛"，必须落 failed 交给扩容续跑 / 重试链。
   */
  'output_budget_exhausted',
  /**
   * 2026-11-08（真机 `pdca_mw7sfwyf`）：TAORLoop 的 `no_tool_call` 死循环检测 critical
   * 会把 `stopReason` 置 `'aborted'`（模型连续多轮只回文本、不调工具）。此前该原因
   * **不在本集合** ⇒ 步骤被记为 `completed`（假完成）⇒ Review 判 REJECT ⇒ retry ⇒
   * 再次 aborted ⇒ 同一批步骤 4 轮反复"完成—拒绝"，最终 escalate/replan 也救不回来。
   * 中止 ≠ 完成：必须落 failed，交给重试/升级链处理。
   */
  'aborted',
  /**
   * P0-3（2026-11-10）：循环守卫细分（`no_tool_call` / `io_loop`）与 `aborted` 同为"未收敛"。
   *
   * 语义不变（原两处守卫就落 `aborted` ⇒ failed），仅让失败原因可区分：
   * 需求阶段实测 5 例中有 2 例自此可归因为"模型连续只回文本 / 文件 IO 反复读写"。
   */
  'no_tool_call',
  'io_loop',
  /**
   * 2026-11-09（真机 `pdca_mw8vmiy9`）：TAORLoop 在**模型调用失败**（当日 DNS/网络中断，
   * `getaddrinfo ENOTFOUND`）时以 `terminationReason='error'` 收尾（turns=1、tokens=0、43ms）。
   * 此前该原因不在本集合 ⇒ 步骤记为 `completed`（假完成）⇒ Review 判 12/100 REJECT ⇒ retry ⇒
   * 再次 error ⇒ 同一批步骤反复"完成—拒绝—重试"，任务最终 `failed` 且日志里全是"已完成"。
   * 与 `aborted` 同理：**异常 ≠ 完成**，必须落 failed 交给重试/升级链处理。
   */
  'error',
]);

export function isNonConvergedTermination(reason?: string): boolean {
  return (
    typeof reason === 'string' && NON_CONVERGED_TERMINATION_REASONS.has(reason)
  );
}

/**
 * P2-5（2026-11-28，台账 L15584）：**计划级一次性重跑**候选判定（纯函数，可单测）。
 *
 * 背景（真机 `pdca_mw8lrnmb`）：step_9（`node self_test.js`）因当时 `game.js` 有语法错而以
 * `aborted` 收尾 ⇒ `failed(non_converged)`；随后 step_5 重写 `game.js` 修好了缺陷，
 * 但 step_9 **永久失败**（步骤内重试对 `aborted` 明确不重试，避免同一守卫立刻再中止）。
 * 「上游步骤后来修好了缺陷」这个前提只有**计划级**看得见。
 *
 * 口径（结构化、有界，不引入新重试框架）：
 *   - 只挑 `isNonConvergedTermination` 的 failed 步骤（预算/中止/循环/异常等"未收敛"）；
 *   - 每步**每 run 至多一次**（`alreadyRerolled` 由调用方记账）；
 *   - 前置依赖必须已 completed（否则重跑没有新前提；未登记的依赖视为无约束）；
 *   - 运行已 halted（用户中止 / 预算耗尽 / 空转熔断 / 等待审批）⇒ 一律不重跑。
 */
export function selectRerollCandidates(input: {
  steps: ReadonlyArray<{
    id: string;
    status: string;
    terminationReason?: string;
    dependsOn?: readonly string[];
  }>;
  alreadyRerolled: ReadonlySet<string>;
  halted: boolean;
  limit: number;
}): string[] {
  if (input.halted || input.limit <= 0) return [];
  const statusById = new Map<string, string>();
  for (const s of input.steps) statusById.set(s.id, s.status);
  const picked: string[] = [];
  for (const s of input.steps) {
    if (picked.length >= input.limit) break;
    if (s.status !== TaskStatus.FAILED) continue;
    if (!isNonConvergedTermination(s.terminationReason)) continue;
    if (input.alreadyRerolled.has(s.id)) continue;
    const depsSatisfied = (s.dependsOn ?? []).every((dep) => {
      const depStatus = statusById.get(dep);
      return depStatus === undefined || depStatus === TaskStatus.COMPLETED;
    });
    if (!depsSatisfied) continue;
    picked.push(s.id);
  }
  return picked;
}

/**
 * U-02（2026-10-19）：计划审批门是否应**自动通过**（无人值守模式）。
 *
 * 语义：仅当调用方要求审批、且当前处于无人值守模式时才自动通过；其余情况保持人工审批。
 * 抽成纯函数以便单测（`runFullPdca` 的审批分支依赖模型计划生成，难以在单测中直驱）。
 */
export function shouldAutoApprovePlan(
  requireApproval: boolean,
  isUnattended: boolean
): boolean {
  return requireApproval && isUnattended;
}

/**
 * P3-2（2026-11-16）：resume **终态闸门**判定（原 `resumeFromCheckpointCore` 内联段，原样外移）。
 *
 * 判据（逐字沿用原实现）：
 *   - `replanResumable`：status=failed + replanPending + 失败计数未达上限 ⇒ 允许走增量 replan；
 *   - `interruptedByScan`：status=abort 且步骤快照非空，且（启动扫描标记 或 phase 仍非终态）
 *     ⇒ 崩溃遗留任务可续跑（M2 可达性修复）；
 *   - `refuse`：终态 phase（无启动扫描标记）或终态 status（不满足上述两项例外）。
 *   - `refuseDetail`：按 `replanPending` 选文案（与旧实现一致，不按"是否真的可续跑"）。
 *
 * 2026-10-17（M2 可达性修复，原注释随判据一并外移）：启动扫描 `scanAndAbortStalePdcaTasks`
 * 会把**崩溃遗留**的活跃任务写成 `status:'abort'`，但保留非终态 phase（execute/review/decide）。
 * 旧判据把该组合当终态一律拒绝 ⇒ P0(M2) 的步骤快照在生产没有有效消费路径。
 * 放行条件严格限定：status=abort **且** 步骤快照非空，且满足任一
 *   ① `abortedBy='startup_scan'`（2026-11-08 真机 `pdca_mw7d3dq3`：扫描为满足
 *      /goal list 的 phase 过滤已把 phase 落 abort ⇒ 必须靠标记识别，否则不可续跑）；
 *   ② phase 仍非终态（旧格式检查点，无标记）。
 */
export function evaluateResumeGate(input: {
  phase: string;
  status?: string;
  replanPending: boolean;
  replanFailCount: number;
  replanMaxRetries: number;
  stepCount: number;
  abortedBy?: unknown;
}): { replanResumable: boolean; refuse: boolean; refuseDetail: string } {
  // 状态词汇取具名枚举（值不变：completed/failed）；`abort` 属 PDCA checkpoint 专有终态。
  const isTerminal = (st?: string): boolean =>
    st === TaskStatus.COMPLETED || st === 'abort' || st === TaskStatus.FAILED;
  const replanResumable =
    input.status === TaskStatus.FAILED &&
    input.replanPending &&
    input.replanFailCount < input.replanMaxRetries;
  const crashAborted = input.abortedBy === 'startup_scan';
  const interruptedByScan =
    input.status === 'abort' &&
    input.stepCount > 0 &&
    (crashAborted || !isTerminal(input.phase));
  const refuse =
    (isTerminal(input.phase) && !crashAborted) ||
    (isTerminal(input.status) && !replanResumable && !interruptedByScan);
  const refuseDetail =
    input.status === TaskStatus.FAILED && !input.replanPending
      ? '，且 replan 已达上限/未挂起，需人工介入'
      : '，不可恢复';
  return { replanResumable, refuse, refuseDetail };
}

/**
 * PDCA 终态裁决（2026-11-09，真机 `pdca_mw81e4z5`）。
 *
 * 背景：`allDone` 的判据是"步骤全部终态"，而 `failed` 也是终态 ⇒ 此前「1 步 failed +
 * 其余 approved」会落 `completed`（汇总显示 `completed:2 / failed:1` 却报成功）。
 * 口径：`failed` **阻塞**成功；`cancelled`（用户 skip）不阻塞；escalate 走可续跑（不算成功）。
 *
 * 抽成纯函数以便直驱单测（终态分支在 `runFullPdca` 尾部，依赖模型计划生成）。
 */
export function decideTerminalOutcome(input: {
  allDone: boolean;
  hasEscalated: boolean;
  failureReason: string | null;
  /** 仅 `failed` 参与裁决（`cancelled` 视为用户主动跳过） */
  failedSteps: ReadonlyArray<{ id: string; description?: string }>;
}): { failureReason: string | null; succeeded: boolean } {
  let failureReason = input.failureReason;
  if (input.failedSteps.length > 0 && failureReason === null) {
    const first = input.failedSteps[0];
    failureReason =
      `PDCA_STEP_FAILED: 步骤「${(first.description || first.id).slice(0, 80)}」未完成` +
      (input.failedSteps.length > 1
        ? `（共 ${input.failedSteps.length} 步失败）`
        : '');
  }
  const succeeded =
    input.allDone &&
    !input.hasEscalated &&
    failureReason === null &&
    input.failedSteps.length === 0;
  return { failureReason, succeeded };
}
