/** 心跳记录 */
export interface HeartbeatRecord {
  taskId: string;
  pid?: number;
  lastHeartbeatAt: number;
  startedAt: number;
  ttlMs: number;
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
