/**
 * P0-4（2026-11-05）：后台任务消息的**唯一标记读取处**。
 *
 * 背景：PDCA / 长程任务与用户会话**共用同一个 sessionId**（真机：`session_mw375o4312e5f31d38`
 * 的 698 条消息里混有 8 条 `01-scope` / 16 条 `FR-12` 之类的 PRD 步骤消息）。后端已在消息
 * `metadata` 上打了 `isTaskMessage`（与 `taskId`），但前端**零消费** ⇒ 这些消息被当成普通
 * 助手回复渲染，用户看到"答非所问"。
 *
 * 本模块只做**读取 + 判定**（结构化标记，不做字符串匹配 —— CS02）：
 *   · 渲染侧：加「任务产出」徽标 + 悬浮说明（不隐藏、不改数据）；
 *   · 导出侧：加 `[任务产出 <taskId>]` 行首标记，使导出件可区分来源。
 *
 * 是否把任务消息**从聊天主流中分离/隐藏**属产品裁定，未在本轮实现。
 */

/** 消息上的任务标记（缺省 ⇒ 普通消息） */
export interface TaskMessageTag {
  isTaskMessage: boolean;
  /** 任务 id（`metadata.taskId`；后端未写时为 undefined） */
  taskId?: string;
}

/** 从消息 metadata 读取任务标记（无标记 ⇒ `{ isTaskMessage: false }`） */
export function readTaskMessageTag(
  metadata: Record<string, unknown> | undefined,
): TaskMessageTag {
  const isTaskMessage = metadata?.isTaskMessage === true;
  const raw = metadata?.taskId;
  const taskId = typeof raw === "string" && raw !== "" ? raw : undefined;
  return isTaskMessage
    ? { isTaskMessage, ...(taskId ? { taskId } : {}) }
    : { isTaskMessage: false };
}
