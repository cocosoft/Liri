/** 心跳记录 */
export interface HeartbeatRecord {
  taskId: string;
  pid?: number;
  lastHeartbeatAt: number;
  startedAt: number;
  ttlMs: number;
  /** P1-5（2026-08-31）：租约持有者标识（进程/worker/会话；beat 续租校验 + 过期抢占依据） */
  owner?: string;
  metadata?: Record<string, unknown>;
}

/** 心跳检测事件 */
export interface HeartbeatTimeoutEvent {
  taskId: string;
  elapsedMs: number;
  ttlMs: number;
  lastHeartbeatAt: number;
}

/** 心跳管理器配置 */
export interface HeartbeatManagerOptions {
  detectIntervalMs?: number;
  defaultTtlMs?: number;
}
