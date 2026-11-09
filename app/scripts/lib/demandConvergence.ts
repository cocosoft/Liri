/**
 * B9（2026-11-09，设计稿 §4 指标 4）：demand / interactive 收敛率的**聚合口径**（纯函数）。
 *
 * 与 I/O 分离（脚本 `report-demand-convergence.ts` 只负责读库/打印），便于直驱单测。
 *
 * **口径（写死，避免各人各算）**：
 * - 样本单位：**根检查点**（一次任务 = 1 样本）。阶段链会为每个阶段另外写 `<父>_<stageId>`
 *   子检查点；若一并计入，一次 demand 任务会被算成 3 个样本（demand 恒走阶段链，
 *   而 interactive 多走单条快速路径）⇒ 两组不可比。子检查点仅在父行不存在时才计入。
 * - 分组：检查点 `data.demand === true` ⇒ demand；否则（含旧任务无该字段）⇒ interactive；
 * - 终态：优先 `phase`（PDCA 相），非终态时回退 `status`（PDL 快路径把终态写成
 *   `phase:'execute' + status:'completed'`，只读 `phase` 会把已完成算成"进行中"）；
 *   终态集合 = `completed` / `failed` / `abort`（与 `PDCA_TERMINAL_PHASES` 同源）；
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
  /**
   * P2（2026-11-10）：**阶段 × 终止原因** 的失败步分布（含阶段子任务）。
   *
   * 收敛率只能回答"差多少"，回答不了"卡在哪一层"。此处按 `taskId` 的阶段后缀
   * （`<父>_requirement` 等）与步骤终止原因聚合，供定位需求阶段空转 / 审批挂起等。
   */
  terminations: TerminationBucket[];
}

/** 失败步的聚合桶 */
export interface TerminationBucket {
  /** 阶段（`requirement` / `design` / `delivery` / `(root)`） */
  stage: string;
  /** 终止原因（步骤 `terminationReason`，或 `dependency_blocked` / `step_failed` / `run_failed`） */
  reason: string;
  count: number;
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

/** 单个检查点的终态（无终态 ⇒ undefined） */
function terminalOf(data: Record<string, unknown>): string | undefined {
  for (const value of [data.phase, data.status]) {
    if (value === 'completed' || value === 'failed' || value === 'abort') {
      return value;
    }
  }
  return undefined;
}

/** 检查点所属阶段（`<父>_<stageId>` ⇒ stageId；否则 `(root)`） */
function stageOfTask(taskId: string, taskIds: ReadonlySet<string>): string {
  const cut = taskId.lastIndexOf('_');
  return cut > 0 && taskIds.has(taskId.slice(0, cut))
    ? taskId.slice(cut + 1)
    : '(root)';
}

/** 聚合失败步：阶段 × 终止原因（含阶段子任务；行级失败但无失败步时单列 `run_failed`） */
function collectTerminations(
  parsedRows: ReadonlyArray<{
    data: Record<string, unknown>;
    taskId: string;
  }>,
  taskIds: ReadonlySet<string>
): TerminationBucket[] {
  const counts = new Map<string, number>();
  const bump = (stage: string, reason: string): void => {
    const key = `${stage}\u0000${reason}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  for (const { data, taskId } of parsedRows) {
    const stage = stageOfTask(taskId, taskIds);
    const steps = Array.isArray(data.steps)
      ? (data.steps as Array<Record<string, unknown>>)
      : [];
    let counted = false;
    for (const step of steps) {
      const status = typeof step.status === 'string' ? step.status : '';
      if (!status || status === 'completed') continue;
      counted = true;
      if (status === 'cancelled') {
        bump(stage, 'dependency_blocked');
        continue;
      }
      const reason =
        typeof step.terminationReason === 'string' &&
        step.terminationReason &&
        step.terminationReason !== 'completed'
          ? step.terminationReason
          : 'step_failed';
      bump(stage, reason);
    }
    const terminal = terminalOf(data);
    if (!counted && (terminal === 'failed' || terminal === 'abort')) {
      bump(stage, `run_${terminal}`);
    }
  }

  return [...counts.entries()]
    .map(([key, count]) => {
      const [stage, reason] = key.split('\u0000');
      return { stage: stage ?? '(root)', reason: reason ?? 'unknown', count };
    })
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.stage.localeCompare(b.stage) ||
        a.reason.localeCompare(b.reason)
    );
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
    terminations: [],
  };

  const parsedRows: Array<{ data: Record<string, unknown>; taskId: string }> =
    [];
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
    parsedRows.push({
      data,
      taskId: typeof data.taskId === 'string' ? data.taskId : '',
    });
  }

  // 根样本判定：`<父 taskId>_<stageId>` 且父行在库 ⇒ 子阶段检查点（父行缺失时保留为样本）
  const taskIds = new Set(
    parsedRows.map((r) => r.taskId).filter((id) => id.length > 0)
  );
  const isStageChild = (taskId: string): boolean => {
    const cut = taskId.lastIndexOf('_');
    return cut > 0 && taskIds.has(taskId.slice(0, cut));
  };

  for (const { data, taskId } of parsedRows) {
    if (isStageChild(taskId)) continue;
    const cohort = data.demand === true ? summary.demand : summary.interactive;
    cohort.samples += 1;
    switch (terminalOf(data)) {
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
        // 非终态（含旧任务缺 phase/status）⇒ 进行中，不计入收敛率
        cohort.inProgress += 1;
    }
  }

  finalizeStats(summary.demand);
  finalizeStats(summary.interactive);
  summary.terminations = collectTerminations(parsedRows, taskIds);
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

  // P2（2026-11-10）：失败分布 —— 回答"卡在哪一层、为什么"
  out.push('', '=== 阶段 × 终止原因（失败步分布）===');
  if (summary.terminations.length === 0) {
    out.push('无失败步。');
  } else {
    out.push(
      ['阶段'.padEnd(14), '终止原因'.padEnd(22), '次数'.padStart(6)].join('')
    );
    for (const bucket of summary.terminations) {
      out.push(
        [
          bucket.stage.padEnd(14),
          bucket.reason.padEnd(22),
          String(bucket.count).padStart(6),
        ].join('')
      );
    }
    out.push(
      '口径: 阶段取 taskId 后缀（父行缺失记 (root)）；cancelled ⇒ dependency_blocked；无失败步的行级失败记 run_failed/run_abort。'
    );
  }
  return out.join('\n');
}
