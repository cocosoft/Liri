/**
 * B9（2026-11-09，设计稿 §4 指标 4）：demand / interactive 收敛率的**聚合口径**（纯函数）。
 *
 * 与 I/O 分离（脚本 `report-demand-convergence.ts` 只负责读库/打印），便于直驱单测。
 *
 * **口径（写死，避免各人各算）**：
 * - 分组：检查点 `data.demand === true` ⇒ demand；否则（含旧任务无该字段）⇒ interactive；
 * - 终态：`completed` / `failed` / `abort`（与 `PDCA_TERMINAL_PHASES` 同源）；
 *   其余（plan / execute / review / decide / plan_pending / stage_awaiting_approval）⇒ 进行中；
 * - **收敛率 = completed / (completed + failed)**：用户中止（abort）不计入分母，
 *   否则"用户主动停掉"会被读成"系统收敛变差"；
 * - 无已结论样本 ⇒ 收敛率为 `null`（不输出 0%）；
 * - 任一分组样本 < `MIN_SAMPLES` ⇒ 显式提示"不作结论"（CS06：少样本不编结论）。
 */

/** 分组的最小样本数（低于此值不作结论） */
export const MIN_SAMPLES = 5;

/** 单个分组的统计 */
export interface CohortStats {
  samples: number;
  completed: number;
  failed: number;
  aborted: number;
  inProgress: number;
  /** 收敛率分母：completed + failed */
  concluded: number;
  /** completed / concluded；无已结论样本 ⇒ null */
  convergedRate: number | null;
}

export interface ConvergenceSummary {
  demand: CohortStats;
  interactive: CohortStats;
  /** JSON 解析失败的行数（分组未知，如实单列） */
  unparsable: number;
  total: number;
}

function emptyStats(): CohortStats {
  return {
    samples: 0,
    completed: 0,
    failed: 0,
    aborted: 0,
    inProgress: 0,
    concluded: 0,
    convergedRate: null,
  };
}

function finalizeStats(stats: CohortStats): void {
  stats.concluded = stats.completed + stats.failed;
  stats.convergedRate =
    stats.concluded > 0 ? stats.completed / stats.concluded : null;
}

/** 聚合检查点行（`raw` = 检查点 data JSON 原文） */
export function summarizeCheckpoints(
  rows: ReadonlyArray<{ raw: string }>
): ConvergenceSummary {
  const summary: ConvergenceSummary = {
    demand: emptyStats(),
    interactive: emptyStats(),
    unparsable: 0,
    total: rows.length,
  };

  for (const row of rows) {
    let data: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(row.raw);
      if (!parsed || typeof parsed !== 'object') {
        summary.unparsable += 1;
        continue;
      }
      data = parsed as Record<string, unknown>;
    } catch {
      summary.unparsable += 1;
      continue;
    }

    const cohort = data.demand === true ? summary.demand : summary.interactive;
    cohort.samples += 1;
    switch (data.phase) {
      case 'completed':
        cohort.completed += 1;
        break;
      case 'failed':
        cohort.failed += 1;
        break;
      case 'abort':
        cohort.aborted += 1;
        break;
      default:
        // 非终态（含旧任务缺 phase）⇒ 进行中，不计入收敛率
        cohort.inProgress += 1;
    }
  }

  finalizeStats(summary.demand);
  finalizeStats(summary.interactive);
  return summary;
}

function pct(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(1)}%`;
}

function row(name: string, s: CohortStats): string {
  return [
    name.padEnd(12),
    String(s.samples).padStart(6),
    String(s.completed).padStart(10),
    String(s.failed).padStart(8),
    String(s.aborted).padStart(7),
    String(s.inProgress).padStart(8),
    pct(s.convergedRate).padStart(9),
  ].join('');
}

/** 人读报告（样本不足显式提示"不作结论"） */
export function formatSummary(
  summary: ConvergenceSummary,
  meta: { dbPath: string; since?: string }
): string {
  const header = [
    '分组'.padEnd(12),
    '样本'.padStart(6),
    'completed'.padStart(10),
    'failed'.padStart(8),
    'abort'.padStart(7),
    '进行中'.padStart(8),
    '收敛率'.padStart(9),
  ].join('');

  const out = [
    '=== demand 收敛率取数（设计稿 §4 指标 4）===',
    `数据库: ${meta.dbPath}`,
    `区间: ${meta.since ? `updated_at >= ${meta.since}` : '全部'}`,
    `检查点: ${summary.total} 条（JSON 解析失败 ${summary.unparsable} 条，分组未知未计入）`,
    '',
    header,
    row('demand', summary.demand),
    row('interactive', summary.interactive),
    '',
    '口径: 收敛率 = completed / (completed + failed)；abort（用户中止）与进行中不计入分母。',
  ];

  if (
    summary.demand.convergedRate !== null &&
    summary.interactive.convergedRate !== null
  ) {
    const delta =
      (summary.demand.convergedRate - summary.interactive.convergedRate) * 100;
    out.push(
      `差值 demand - interactive = ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp`
    );
  }

  const thin: string[] = [];
  if (summary.demand.samples < MIN_SAMPLES) thin.push('demand');
  if (summary.interactive.samples < MIN_SAMPLES) thin.push('interactive');
  if (thin.length > 0) {
    out.push(
      `⚠️ 样本不足（< ${MIN_SAMPLES}）：${thin.join(' / ')} —— 不作结论，请继续积累任务样本。`
    );
  }
  return out.join('\n');
}
