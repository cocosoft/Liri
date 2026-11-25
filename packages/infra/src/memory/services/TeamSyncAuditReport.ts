/**
 * 团队记忆同步审计报表（Phase 2N-7，2026-11-25）
 *
 * 数据源：`<team-memory>/sync-history.jsonl`（共享目录版与网络版每轮各追加一条，
 * 见 `TeamMemorySharedDirSync.appendTeamSyncHistory`）。本模块只做**只读聚合**：
 * 行解析失败/字段越界一律收敛，不上抛、不改写历史文件。
 */

/** 单轮同步历史（磁盘行 + 收敛后的数值） */
export interface TeamSyncHistoryEntry {
  at: string | null;
  pulled: number;
  pushed: number;
  pullConflicts: number;
  pushConflicts: number;
  rejectedSecrets: number;
  errors: number;
}

export interface TeamSyncAuditReport {
  /** 参与统计的历史轮数 */
  cycles: number;
  pulled: number;
  pushed: number;
  conflicts: number;
  rejectedSecrets: number;
  errors: number;
  /** 最近一轮时间（ISO；无历史 ⇒ null） */
  lastAt: string | null;
  /** 有错误的轮次占比（0..1；无历史 ⇒ 0） */
  errorRate: number;
  /** 最近 N 轮（倒序，最新在前） */
  recent: TeamSyncHistoryEntry[];
}

/** 默认最多读取的历史行数（与 `appendTeamSyncHistory` 的保留上限一致） */
const HISTORY_KEEP_ROWS = 200;

/** 非有限/负数/小数 ⇒ 非负整数（不影响统计口径） */
function toCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * 解析一行历史（坏 JSON / 非对象 ⇒ null，调用方跳过）。
 */
function parseHistoryLine(line: string): TeamSyncHistoryEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  return {
    at: typeof record.at === 'string' ? record.at : null,
    pulled: toCount(record.pulled),
    pushed: toCount(record.pushed),
    pullConflicts: toCount(record.pullConflicts),
    pushConflicts: toCount(record.pushConflicts),
    rejectedSecrets: toCount(record.rejectedSecrets),
    errors: toCount(record.errors),
  };
}

/**
 * 读取同步历史（文件缺失/不可读 ⇒ 空数组；坏行跳过）。
 *
 * @param teamDir 团队目录（网络版 = `config.localDir`；共享目录版 = 数据目录下的 `team-memory`）
 * @param limit   最多返回多少条（保留**最近**的 `limit` 条，文件顺序）
 */
export async function readTeamSyncHistory(
  teamDir: string,
  limit: number = HISTORY_KEEP_ROWS
): Promise<TeamSyncHistoryEntry[]> {
  const { readFile } = await import('fs/promises');
  const { join } = await import('path');

  let raw = '';
  try {
    raw = await readFile(join(teamDir, 'sync-history.jsonl'), 'utf-8');
  } catch {
    return [];
  }

  const entries: TeamSyncHistoryEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const entry = parseHistoryLine(line);
    if (entry) entries.push(entry);
  }

  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  return max > 0 ? entries.slice(-max) : [];
}

/**
 * 聚合审计报表（纯函数，便于单测）。
 *
 * @param records     历史记录（文件顺序：旧 → 新）
 * @param recentLimit 报表里保留的最近轮数（默认 20；≤0 ⇒ 不附明细）
 */
export function buildTeamSyncAuditReport(
  records: TeamSyncHistoryEntry[],
  recentLimit: number = 20
): TeamSyncAuditReport {
  const report: TeamSyncAuditReport = {
    cycles: records.length,
    pulled: 0,
    pushed: 0,
    conflicts: 0,
    rejectedSecrets: 0,
    errors: 0,
    lastAt: null,
    errorRate: 0,
    recent: [],
  };
  if (records.length === 0) return report;

  let erroredCycles = 0;
  for (const record of records) {
    report.pulled += record.pulled;
    report.pushed += record.pushed;
    report.conflicts += record.pullConflicts + record.pushConflicts;
    report.rejectedSecrets += record.rejectedSecrets;
    report.errors += record.errors;
    if (record.errors > 0) erroredCycles += 1;
  }

  const last = records[records.length - 1];
  report.lastAt = last?.at ?? null;
  report.errorRate = erroredCycles / records.length;

  const limit =
    Number.isFinite(recentLimit) && recentLimit > 0
      ? Math.floor(recentLimit)
      : 0;
  report.recent = limit > 0 ? [...records].slice(-limit).reverse() : [];

  return report;
}
