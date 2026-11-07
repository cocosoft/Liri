// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * resumeSingleFlight — PDCA「审批后续跑」的**单飞**（2026-11-07，隐藏缺陷 #3）。
 *
 * **问题**：`resumeAfterApproval` 有两条外部入口 —— Inbox 审批（`inboxApproval`）与
 * CLI `/goal approve`（`commands/builtin/goal/Goal.ts`）。编排器内部**没有互斥**，
 * 两者并发会同时进入 `_runExecuteDecideLoop` ⇒ 同一步骤的工具副作用重复执行。
 *
 * **做法**：以**编排器实例**为键（`WeakMap`，随实例回收，不占宿主字段）记录在飞 Promise；
 * 同实例并发调用复用同一个 Promise。注意与"去重"的区别：它只保证**同时**不双跑，
 * 串行到达的下一次续跑（如 D16 的早批重试）仍会正常执行。
 */

const flights = new WeakMap<object, Promise<unknown>>();

/** 同一编排器上的审批续跑只跑一个循环；并发调用复用同一个 Promise */
export function resumePdcaOnce<T extends { phase: string }>(
  orchestrator: object,
  run: () => Promise<T>
): Promise<T> {
  const existing = flights.get(orchestrator);
  if (existing) return existing as Promise<T>;
  const running = run().finally(() => {
    flights.delete(orchestrator);
  });
  flights.set(orchestrator, running);
  return running;
}
