/**
 * 姿态快照读取与新鲜度判定（围栏 M1）。
 *
 * 只读 `sandbox-posture.json`（主进程 M0-③ 原子落盘），把它归一为
 * `ok / stale / missing / invalid` 四态 —— **`missing` 不等于 `ok`**，
 * `stale` 也不等于 `missing`（前者文件在但过期，后者从未写过或已被删）。
 */
import type { FencePostureObservation, FencePostureSnapshot } from './types';

/** 围栏认得的快照结构版本（主进程 `SANDBOX_POSTURE_SNAPSHOT_SCHEMA_VERSION`） */
export const FENCE_POSTURE_SCHEMA_VERSION = 1;

export type ParsePostureResult =
  | { ok: true; snapshot: FencePostureSnapshot }
  | { ok: false; reason: string };

/**
 * 严格解析姿态快照：结构版本不符 / 关键字段缺失 / 时间不可解析 ⇒ `invalid`（不猜）。
 */
export function parseFencePostureSnapshot(raw: string): ParsePostureResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      reason: `JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: '顶层不是对象' };
  }
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== FENCE_POSTURE_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `未知 schemaVersion: ${String(record.schemaVersion)}`,
    };
  }
  if (typeof record.capturedAt !== 'string') {
    return { ok: false, reason: 'capturedAt 缺失或不是字符串' };
  }
  const capturedAtMs = Date.parse(record.capturedAt);
  if (Number.isNaN(capturedAtMs)) {
    return { ok: false, reason: `capturedAt 不可解析: ${record.capturedAt}` };
  }
  return {
    ok: true,
    snapshot: {
      schemaVersion: FENCE_POSTURE_SCHEMA_VERSION,
      capturedAt: record.capturedAt,
      mode: typeof record.mode === 'string' ? record.mode : 'unknown',
      permissionLevel:
        typeof record.permissionLevel === 'string'
          ? record.permissionLevel
          : 'unknown',
      bashSandboxReason:
        typeof record.bashSandboxReason === 'string'
          ? record.bashSandboxReason
          : 'unknown',
      landlock: normalizeLandlock(record.landlock),
      openRiskCodes: toStringArray(record.openRiskCodes),
      openRisks: toStringArray(record.openRisks),
      violationCount:
        typeof record.violationCount === 'number' ? record.violationCount : 0,
      recentViolations: normalizeRecentViolations(record.recentViolations),
    },
  };
}

/** 把「文件是否存在 + 原始内容 + 当前时刻」归一为四态观察结论 */
export function observeFencePosture(input: {
  exists: boolean;
  raw?: string;
  now: Date;
  staleAfterMs: number;
}): FencePostureObservation {
  if (!input.exists || input.raw === undefined) {
    return { state: 'missing' };
  }
  const parsed = parseFencePostureSnapshot(input.raw);
  if (!parsed.ok) {
    return { state: 'invalid', reason: parsed.reason };
  }
  const ageMs = Math.max(
    0,
    input.now.getTime() - Date.parse(parsed.snapshot.capturedAt)
  );
  const base: FencePostureObservation = {
    state: ageMs > input.staleAfterMs ? 'stale' : 'ok',
    capturedAt: parsed.snapshot.capturedAt,
    ageMs,
    violationCount: parsed.snapshot.violationCount,
    openRiskCodes: parsed.snapshot.openRiskCodes,
  };
  return base;
}

function normalizeLandlock(value: unknown): FencePostureSnapshot['landlock'] {
  const record =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  return {
    enabled: record.enabled === true,
    bashEnabled: record.bashEnabled === true,
    failClosed: record.failClosed === true,
    available: record.available === true,
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeRecentViolations(
  value: unknown
): FencePostureSnapshot['recentViolations'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    if (typeof record.type !== 'string' || typeof record.message !== 'string') {
      return [];
    }
    return [
      {
        type: record.type,
        message: record.message,
        timestamp: typeof record.timestamp === 'string' ? record.timestamp : '',
      },
    ];
  });
}
