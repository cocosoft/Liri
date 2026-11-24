/**
 * 伙伴域实时事件（2026-11-25）
 *
 * 用于把「孵化 / 成长（经验·等级）」这类发生在服务内部的变化实时推给前端：
 * - `buddy:hatched`：首条用户消息自动孵化成功后广播（伙伴快照从 null → 有值）；
 * - `buddy:growth`：经验/等级变化后广播（梦境完成、任务完成、互动）。
 *
 * SSE 未启动（CLI/TEST）时忽略即可 —— 状态已持久化到 `config` / `buddy-growth.json`，
 * 前端下次读取仍然正确。
 */
import { broadcastEvent } from '@modules/infrastructure';

/** 孵化成功 */
export const BUDDY_HATCHED_EVENT = 'buddy:hatched';
/** 成长（经验 / 等级）变化 */
export const BUDDY_GROWTH_EVENT = 'buddy:growth';

export type BuddySseEvent =
  | typeof BUDDY_HATCHED_EVENT
  | typeof BUDDY_GROWTH_EVENT;

/** 广播伙伴事件（SSE 不可用时静默忽略） */
export function broadcastBuddyEvent(
  event: BuddySseEvent,
  payload: Record<string, unknown>
): void {
  try {
    broadcastEvent(event, payload);
  } catch {
    /* SSE 未启动（CLI/TEST）：状态已持久化，无需补偿 */
  }
}
