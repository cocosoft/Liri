/**
 * SelfWake 自唤醒系统类型定义
 *
 * P0-1: 对标 openworker WakeStore — pending→due→fired 状态机
 */

/**
 * 唤醒类型。
 *
 * T-⑥12（2026-10-03）：由 `enum` 改为 **const 对象 + 字面量联合**（与 shared `STATUS_TYPE`
 * 同款）——使 `WakeKind.TIMER` 的类型就是字面量 `'timer'`，可直接赋给事件载荷
 * `session/wake.kind`（`enum` 成员类型无法赋给字面量联合；而载荷在 `session/types`（service）
 * 不得反向引用 `tasks`（app）类型）。取值不变，使用处（`WakeKind.TIMER` / `kind: WakeKind`）不受影响。
 */
export const WakeKind = {
  TIMER: 'timer', // sleep_for(seconds) / sleep_until(ISO)
  COMPLETION: 'completion', // wake_on(job_id) — 后台任务完成时
  EVENT: 'event', // wake_on_event(event_key) — connector/webhook 事件
} as const;

export type WakeKind = (typeof WakeKind)[keyof typeof WakeKind];

/**
 * 唤醒状态机
 *
 * 2026-11-24（批次 2 / A3）：补齐中间态与终态 —— 原状态机只有 `pending | due | fired`，
 * 且 `fire()` **先置 `fired` 再续跑** ⇒ 续跑失败也记为已唤醒（唤醒被静默吞掉）。
 *
 * ```
 * pending/due ──CAS──▶ firing ──续跑成功──▶ fired
 *                          └──失败──▶ pending（attempts+1）──≥3──▶ failed
 * pending/due ──expiresAt 到期──▶ expired
 * firing ──进程崩溃（启动期复位）──▶ pending
 * ```
 *
 * `firing` 是**单进程内**的抢锁中间态（与 Inbox 审批的 `processing` 同构）：
 * 防止 cron tick 重扫与短时 `setTimeout` 同时 `fire()` 造成双续跑。
 */
export type WakeStatus =
  | 'pending'
  | 'due'
  | 'firing'
  | 'fired'
  | 'failed'
  | 'expired';

/** 单个唤醒记录 */
export interface WakeEntry {
  id: string;
  kind: WakeKind;
  status: WakeStatus;
  sessionId: string;
  taskId: string;
  triggerAt?: number; // KIND_TIMER: Unix ms timestamp
  /**
   * 外部条件类唤醒（`completion` / `event`）的等待上限（Unix ms）。
   * 2026-11-24（批次 2 / A3）：`wake_on_job` / `wake_on_event` 没有触发源时**永不 due**
   * ⇒ 无该字段会永久停在 `pending`（前端「等待中」常驻）。到期由 `WakeStore.expireStale` 收敛。
   */
  expiresAt?: number;
  jobId?: string; // KIND_COMPLETION: background task ID
  eventKey?: string; // KIND_EVENT: connector event name
  createdAt: number;
  firedAt?: number;
  /** 已失败的续跑次数（批次 2：≥3 转 `failed`，不再无限重试） */
  attempts?: number;
  /** 进入 `firing` 的时刻（启动期复位崩溃残留用） */
  firingAt?: number;
  failedAt?: number;
  expiredAt?: number;
  /** 最近一次续跑失败原因（可观测；`failed` 后保留） */
  lastError?: string;
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
