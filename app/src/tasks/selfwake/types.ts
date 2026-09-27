/**
 * SelfWake 自唤醒系统类型定义
 *
 * P0-1: 对标 openworker WakeStore — pending→due→fired 状态机
 */

/** 唤醒类型 */
export enum WakeKind {
  TIMER = 'timer', // sleep_for(seconds) / sleep_until(ISO)
  COMPLETION = 'completion', // wake_on(job_id) — 后台任务完成时
  EVENT = 'event', // wake_on_event(event_key) — connector/webhook 事件
}

/** 唤醒状态机 */
export type WakeStatus = 'pending' | 'due' | 'fired';

/** 单个唤醒记录 */
export interface WakeEntry {
  id: string;
  kind: WakeKind;
  status: WakeStatus;
  sessionId: string;
  taskId: string;
  triggerAt?: number; // KIND_TIMER: Unix ms timestamp
  jobId?: string; // KIND_COMPLETION: background task ID
  eventKey?: string; // KIND_EVENT: connector event name
  createdAt: number;
  firedAt?: number;
}

/** SelfWake 服务接口 */
export interface ISelfWakeService {
  sleepFor(
    sessionId: string,
    taskId: string,
    seconds: number
  ): Promise<WakeEntry>;
  sleepUntil(
    sessionId: string,
    taskId: string,
    whenIso: string
  ): Promise<WakeEntry>;
  wakeOnJob(
    sessionId: string,
    taskId: string,
    jobId: string
  ): Promise<WakeEntry>;
  wakeOnEvent(
    sessionId: string,
    taskId: string,
    eventKey: string
  ): Promise<WakeEntry>;
  getDueWakes(): WakeEntry[];
  /**
   * 按会话取"待触发"（`pending` | `due`）唤醒项，按 `triggerAt` 升序（无 `triggerAt` 排最后）。
   *
   * 2026-09-27（等待态可见性，Spec `wait-state-visibility.md` D1）：供只读查询面使用 ——
   * 长等待（`sleep_for` / `wake_on_job`…）期间"会话仍在等"这一事实的**唯一来源**，
   * 由 `GET /v1/sessions/:id/streaming` 的 `pendingWake` 字段对外表达。
   * 只读，不改状态；无记录 ⇒ 空数组（不抛错）。
   */
  getPendingBySession(sessionId: string): Promise<WakeEntry[]>;
  fire(wakeId: string): Promise<void>;
}
