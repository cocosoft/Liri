/**
 * demand 验收指标 2/3 的取数口径（2026-11-10）
 *
 * 设计稿（`dev_docs/20261109/Liri-demand许愿式模式设计方案-20261109.md` §4）定义了四条验收：
 *   指标 1 缺省行为不变  —— 全量测试 + 日志对比（本脚本不重复取数，由 `bun test` 门禁覆盖）；
 *   指标 2 白名单内零打断 —— demand 会话在只读 / 工作区内写场景下 `ask` 次数 = 0；
 *   指标 3 交付覆盖率     —— 终态必有一条回执（回执数 = 终态数）；
 *   指标 4 不退化为空转   —— 收敛率（见 `demandConvergence.ts`，已有脚本）。
 *
 * 本模块只把 **2/3** 落成可重复的纯函数：
 *   - ask 事件取日志 `Tool approval submitted to Inbox`（`PermissionChecker` 的审批卡提交点，
 *     带 `meta.sessionId`）；
 *   - 回执取日志 `PDCA 终态回执已发出`（2026-11-10 起由 `emitPdcaReceiptText` 打出）。
 *
 * **口径（写死，避免各人各算）**：
 *   - 分组沿用指标 4 的根任务身份（`listRootTasks`）与 `sessionId` 归属；
 *   - 只统计**日志窗口内**的终态任务：任务 id 在日志中出现过才算"窗口覆盖"，
 *     否则多为日志轮转前的老任务 ⇒ 单列 `outsideWindow`，不计入覆盖率分母（CS06：不编造缺口）；
 *   - 缺回执的 taskId 最多列 `MAX_MISSING_LIST` 条（其余只报数量）。
 */

import type { RootTaskInfo } from './demandConvergence';

/** 缺回执清单的最大展示条数 */
export const MAX_MISSING_LIST = 10;

/** 审批卡提交的日志文案（`PermissionChecker`：ask 落到收件箱的唯一收口） */
export const APPROVAL_LOG_MESSAGE = 'Tool approval submitted to Inbox';

/** 终态回执已发出的日志文案（`terminalReceipt.emitPdcaReceiptText`） */
export const RECEIPT_LOG_MESSAGE = 'PDCA 终态回执已发出';

/**
 * demand 专属日志（`terminalReceipt` 只在 demand 任务落 `delivery.md`）。
 *
 * 指标 1「缺省行为不变」的可机械判定部分：这条日志**不得**出现在 interactive 任务上。
 */
export const DEMAND_ONLY_LOG_MESSAGE = 'demand 交付回执已落盘';

export interface DeliveryCoverage {
  /** 日志窗口内的终态任务数（覆盖率分母） */
  terminals: number;
  /** 其中有回执的任务数 */
  delivered: number;
  /** 缺回执的 taskId（最多 MAX_MISSING_LIST 条） */
  missing: string[];
  /** 缺回执的完整数量（可能大于 missing.length） */
  missingCount: number;
  /** 日志窗口覆盖不到的终态任务数（不计入分母） */
  outsideWindow: number;
}

export interface DemandAcceptanceSummary {
  /** 指标 2：各组审批卡提交次数（ask） */
  approvals: { demand: number; interactive: number };
  /** 指标 3：各组回执覆盖率 */
  delivery: { demand: DeliveryCoverage; interactive: DeliveryCoverage };
  /**
   * 指标 1（可机械判定部分）：demand 专属日志落在各组的次数。
   *
   * 期望 `interactive = 0` —— 非 0 说明 demand 专有行为泄漏到了普通会话。
   */
  demandOnlyLogs: { demand: number; interactive: number; unknown: number };
  log: { lines: number; parsed: number };
}

interface ParsedLogLine {
  message: string;
  sessionId?: string;
  taskId?: string;
}

function parseLogLines(lines: readonly string[]): {
  parsed: ParsedLogLine[];
  parsedCount: number;
} {
  const parsed: ParsedLogLine[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      const candidate: unknown = JSON.parse(trimmed);
      if (!candidate || typeof candidate !== 'object') continue;
      obj = candidate as Record<string, unknown>;
    } catch {
      continue;
    }
    const message = typeof obj.message === 'string' ? obj.message : '';
    if (!message) continue;
    const meta =
      obj.meta && typeof obj.meta === 'object'
        ? (obj.meta as Record<string, unknown>)
        : {};
    parsed.push({
      message,
      ...(typeof meta.sessionId === 'string'
        ? { sessionId: meta.sessionId }
        : {}),
      ...(typeof meta.taskId === 'string' ? { taskId: meta.taskId } : {}),
    });
  }
  return { parsed, parsedCount: parsed.length };
}

function emptyCoverage(): DeliveryCoverage {
  return {
    terminals: 0,
    delivered: 0,
    missing: [],
    missingCount: 0,
    outsideWindow: 0,
  };
}

/**
 * 聚合验收指标 2/3。
 *
 * @param tasks 根任务身份（`listRootTasks` 的产物）
 * @param logLines `app.log` 的**原始行**（JSON lines；非 JSON 行忽略）
 */
export function summarizeDemandAcceptance(
  tasks: readonly RootTaskInfo[],
  logLines: readonly string[]
): DemandAcceptanceSummary {
  const { parsed } = parseLogLines(logLines);

  const demandSessions = new Set(
    tasks.filter((t) => t.demand && t.sessionId).map((t) => t.sessionId!)
  );
  const interactiveSessions = new Set(
    tasks.filter((t) => !t.demand && t.sessionId).map((t) => t.sessionId!)
  );

  const summary: DemandAcceptanceSummary = {
    approvals: { demand: 0, interactive: 0 },
    delivery: { demand: emptyCoverage(), interactive: emptyCoverage() },
    demandOnlyLogs: { demand: 0, interactive: 0, unknown: 0 },
    log: { lines: logLines.length, parsed: parsed.length },
  };

  const cohortByTaskId = new Map<string, boolean>(
    tasks.map((t) => [t.taskId, t.demand])
  );

  const receipts = new Set<string>();
  const seenInLog = new Set<string>();
  for (const line of parsed) {
    if (line.message === APPROVAL_LOG_MESSAGE && line.sessionId) {
      if (demandSessions.has(line.sessionId)) summary.approvals.demand += 1;
      else if (interactiveSessions.has(line.sessionId)) {
        summary.approvals.interactive += 1;
      }
    }
    if (line.message === RECEIPT_LOG_MESSAGE && line.taskId) {
      receipts.add(line.taskId);
    }
    if (line.message === DEMAND_ONLY_LOG_MESSAGE) {
      const demand = line.taskId ? cohortByTaskId.get(line.taskId) : undefined;
      if (demand === true) summary.demandOnlyLogs.demand += 1;
      else if (demand === false) summary.demandOnlyLogs.interactive += 1;
      else summary.demandOnlyLogs.unknown += 1;
    }
  }

  // 窗口覆盖判定：终态任务 id 是否在日志里出现过（回执行本身也算）
  // 用"整段文本 + includes"代替逐行比对（10 万行 × 数十任务会退化成百万次比较）
  const joinedLog = logLines.join('\n');
  for (const task of tasks) {
    if (task.terminal && joinedLog.includes(task.taskId)) {
      seenInLog.add(task.taskId);
    }
  }

  for (const task of tasks) {
    if (!task.terminal) continue;
    const coverage = task.demand
      ? summary.delivery.demand
      : summary.delivery.interactive;
    const delivered = receipts.has(task.taskId);
    if (!delivered && !seenInLog.has(task.taskId)) {
      // 日志窗口未覆盖（多为轮转前的老任务）⇒ 不计入分母，也不当作缺口
      coverage.outsideWindow += 1;
      continue;
    }
    coverage.terminals += 1;
    if (delivered) {
      coverage.delivered += 1;
      continue;
    }
    coverage.missingCount += 1;
    if (coverage.missing.length < MAX_MISSING_LIST) {
      coverage.missing.push(task.taskId);
    }
  }

  return summary;
}

/**
 * 按日志时间窗过滤（`since` 为 ISO 日期/时间；ISO 8601 的字典序即时间序，可直接字符串比较）。
 *
 * 无 `timestamp` 字段的行**保留**：无法判定时不擅自丢弃（宁可多算，不可漏证据）。
 */
export function filterLogLinesSince(
  lines: readonly string[],
  since?: string
): string[] {
  if (!since) return [...lines];
  return lines.filter((line) => {
    const match = /"timestamp"\s*:\s*"([^"]+)"/.exec(line);
    return match ? match[1] >= since : true;
  });
}

function pct(delivered: number, terminals: number): string {
  return terminals > 0 ? `${((delivered / terminals) * 100).toFixed(1)}%` : '—';
}

/** 人读报告（指标 1/2/3 段落） */
export function formatAcceptance(
  summary: DemandAcceptanceSummary,
  meta: { logPath: string; since?: string }
): string {
  const out = [
    '=== demand 验收取数（设计稿 §4 指标 1/2/3）===',
    `日志: ${meta.logPath}`,
    `区间: ${meta.since ? `timestamp >= ${meta.since}` : '全部'}`,
    `日志行: ${summary.log.lines} 条（可解析 ${summary.log.parsed} 条）`,
    '',
    '指标 1 · 缺省行为不变（demand 专属日志不得落在 interactive 任务上，期望 interactive = 0）',
    `  demand      ${String(summary.demandOnlyLogs.demand).padStart(4)} 条（${DEMAND_ONLY_LOG_MESSAGE}）`,
    `  interactive ${String(summary.demandOnlyLogs.interactive).padStart(4)} 条` +
      (summary.demandOnlyLogs.interactive === 0 ? '  ✅' : '  ❌ 泄漏'),
    ...(summary.demandOnlyLogs.unknown > 0
      ? [`  未知任务    ${String(summary.demandOnlyLogs.unknown).padStart(4)} 条（不在检查点里）`]
      : []),
    '',
    '指标 2 · 白名单内零打断（ask 次数，期望 demand = 0）',
    `  demand      ${String(summary.approvals.demand).padStart(4)} 次`,
    `  interactive ${String(summary.approvals.interactive).padStart(4)} 次`,
    '',
    '指标 3 · 交付覆盖率（回执数 / 窗口内终态数，期望 100%）',
  ];

  for (const [name, coverage] of [
    ['demand', summary.delivery.demand],
    ['interactive', summary.delivery.interactive],
  ] as const) {
    out.push(
      `  ${name.padEnd(11)} ${String(coverage.delivered).padStart(3)} / ${String(
        coverage.terminals
      ).padStart(3)}  (${pct(coverage.delivered, coverage.terminals)})` +
        (coverage.outsideWindow > 0
          ? `  窗口外终态 ${coverage.outsideWindow}（不计入）`
          : '')
    );
    if (coverage.missingCount > 0) {
      const tail =
        coverage.missingCount > coverage.missing.length
          ? ` …另有 ${coverage.missingCount - coverage.missing.length} 条`
          : '';
      out.push(`    缺回执: ${coverage.missing.join(', ')}${tail}`);
    }
  }

  out.push(
    '',
    '口径: ask 取 `Tool approval submitted to Inbox`（按会话归组）；回执取 `PDCA 终态回执已发出`（按 taskId）；' +
      'demand 专属日志取 `demand 交付回执已落盘`（按 taskId 归组）；' +
      '日志窗口未覆盖的老任务单列，不计入覆盖率分母。',
    '指标 1 的其余部分（未设置 autonomy 时既有用例全绿）由全量 `bun test` 门禁覆盖。'
  );
  return out.join('\n');
}
