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
  fire(wakeId: string): Promise<void>;
}
