// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `turn/end` 单写者登记（跨层幂等，2026-11-24 · 前端任务面板治理 · 批次 2）。
 *
 * 背景（真机 `session_mwq5ookl21aa28ea96`）：turn 2 同时出现
 * `turn/end{terminationReason:'awaiting_approval'}` 与 `turn/end{finishReason:'canceled'}`。
 *
 * 机制：管理层 `_writeTurnEnd` 已用中央幂等登记去重，但编排器兜底
 * `finalizeStreamFlow` 只检查**内存布尔** `turnTrace.ended`；一旦 finalize 在写完
 * `turn/end` 之后、置位之前抛错，兜底会再写一条 `canceled` ⇒ 前端把"等待审批"
 * 显示成"生成中断"。
 *
 * 本模块把登记下沉为**叶子模块**（零依赖），管理层的 `ChatEventLogStore` 与编排器兜底
 * 共用同一份登记 ⇒ 同一 turn 的 `turn/end` 恒为 1 条。
 */

const endedTurnsBySession = new Map<string, Set<number>>();

/** 登记某会话的指定 turn 已写 `turn/end`（`turn <= 0` 忽略） */
export function markTurnEnded(sessionId: string, turn: number): void {
  if (turn <= 0) return;
  let set = endedTurnsBySession.get(sessionId);
  if (!set) {
    set = new Set<number>();
    endedTurnsBySession.set(sessionId, set);
  }
  set.add(turn);
}

/** 该会话的指定 turn 是否已写 `turn/end` */
export function hasTurnEnded(sessionId: string, turn: number): boolean {
  return endedTurnsBySession.get(sessionId)?.has(turn) ?? false;
}

/** 清空登记（仅测试用；生产无需重置——进程内单次运行） */
export function __resetTurnEndRegistry(): void {
  endedTurnsBySession.clear();
}
