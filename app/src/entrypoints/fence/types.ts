/**
 * 围栏（G4 / M1）数据契约。
 *
 * **刻意不 import** `permission` / `security` / `sandbox` 的任何运行时代码：
 * 围栏是**另一个进程**的只读观察者，观察者与被观察者共享代码会一起被同一份缺陷污染。
 * 这里的字段只描述**落盘 JSON 的形状**（镜像见
 * `app/src/entrypoints/sandboxPostureSnapshot.ts` 与 `SecurityAuditLogger` 的事件字段），
 * 解析时按 `schemaVersion` 严格校验、不猜。
 */

/** 姿态快照（由主进程 M0-③ 落盘；本模块只读） */
export interface FencePostureSnapshot {
  schemaVersion: number;
  capturedAt: string;
  mode: string;
  permissionLevel: string;
  bashSandboxReason: string;
  landlock: {
    enabled: boolean;
    bashEnabled: boolean;
    failClosed: boolean;
    available: boolean;
  };
  openRiskCodes: string[];
  openRisks: string[];
  violationCount: number;
  recentViolations: Array<{
    type: string;
    message: string;
    timestamp: string;
  }>;
}

/** 姿态观察结论（`stale` ≠ `missing`：数据存在但过期，必须区分） */
export type FencePostureState = 'ok' | 'stale' | 'missing' | 'invalid';

export interface FencePostureObservation {
  state: FencePostureState;
  /** 解析成功时才有 */
  capturedAt?: string;
  ageMs?: number;
  violationCount?: number;
  openRiskCodes?: string[];
  /** `invalid` 时的原因（不得吞掉） */
  reason?: string;
}

/** 围栏告警类别（M1 只覆盖生命周期事件；S1–S4 规则在 M2） */
export type FenceAlertKind =
  | 'log-rotated'
  | 'audit-log-missing'
  | 'audit-line-invalid'
  | 'posture-missing'
  | 'posture-invalid'
  | 'posture-stale';

export interface FenceAlert {
  at: string;
  kind: FenceAlertKind;
  detail?: string;
}

/** 心跳：`no-signal` 必须与"一切正常"区分开（见设计文档 §9 R1） */
export type FenceHeartbeatStatus = 'observing' | 'no-signal';

export interface FenceHeartbeat {
  schemaVersion: number;
  at: string;
  status: FenceHeartbeatStatus;
  audit: {
    exists: boolean;
    /** 本次 tick 新读到的行数 */
    appendedEvents: number;
    /** 当前文件内的字节偏移（截断/轮转后归零） */
    offset: number;
    /** 最后一行合法 JSON 事件的 `timestamp`（有则记） */
    lastEventAt?: string;
  };
  posture: FencePostureObservation;
}
