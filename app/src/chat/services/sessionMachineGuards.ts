// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * sessionMachineGuards — 会话状态机的**调用侧归一**（P0，2026-11-24）。
 *
 * 背景（真机 `session_mwq5ookl21aa28ea96`）：`SESSION_TRANSITIONS` 只允许
 * `idle → running`、`running → {idle, requires_action}`、`requires_action → {running, idle}`
 * （`packages/infra/src/state/session/types.ts`）。`streamFinalize` 在"等待审批"分支
 * 直接 `pause()`（目标 `requires_action`），一旦机器当前是 `idle` 就抛
 * `IllegalTransitionError`；抛错点在 `turn/end{awaiting_approval}` 已写入之后 ⇒
 * 编排器兜底再写一条 `turn/end{canceled}`，前端把"等待审批"显示成"已中断"。
 *
 * 取舍：**不改转移表**（`idle → requires_action` 仍是非法边，避免掩盖"机器为何停在 idle"
 * 这类生命周期问题），而是在调用侧把 `idle` 归一为 `running` 再暂停，并让调用方留痕。
 * 转移表契约由 `SessionStateMachine.test.ts` 继续锁定（含"idle 时 pause 应抛出"）。
 */

/** 仅需被消费的最小面（真实类型为 `SessionStateMachine`；测试可传替身） */
export interface PauseableSessionMachine {
  /**
   * 是否处于"尚未开始"（`SessionStateMachine.canStart()` ⇒ 3 态下的 `idle`）。
   *
   * 用方法而非比较状态字符串：`SESSION_TRANSITIONS` 的取值是**类型约束的唯一事实源**，
   * 消费侧不裸写 `'idle'`（`lint:state-ratchet` 口径）。
   */
  canStart(): boolean;
  start(reason?: string): unknown;
  pause(reason?: string): unknown;
}

/**
 * 等待审批收口：未开始的机器先 `start()` 归一到 `running` 再 `pause()`。
 *
 * @returns 是否发生了归一（`true` = 调用方应记一条 warn/指标，用于观测该路径频次）
 */
export function pauseForApproval(
  machine: PauseableSessionMachine,
  reason: string
): boolean {
  if (!machine.canStart()) {
    machine.pause(reason);
    return false;
  }
  machine.start('pause 前归一（idle → running）');
  machine.pause(reason);
  return true;
}
