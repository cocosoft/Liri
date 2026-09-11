/**
 * CompileProgressTracker — 编译进度追踪器（方案 B v7：阶段状态机）
 *
 * Phase 3 W9 原始版本只跟踪"文件计数"（current/total）。
 * v7 升级为 **9 阶段状态机**，供前端"加工流水线"页真实呈现阶段级进度。
 *
 * 设计要点（详见 知识加工流水线前端可视化方案-B.md §3.1）：
 * - 状态迁移受矩阵约束，非法迁移开发期 assert
 * - 节流只作用于 detail 心跳；状态迁移立即广播
 * - `sessionId` / `seq` 全局单调，60s 重置不归零（G24）
 * - `beginCompileSession` 复位 `sessionTerminated` 并把 `status` 置回 `compiling`（G23/G29）
 * - `abortCompileProgress` 与 `finishCompileSession` 对称：都 settle、都断言、都挂 60s 重置（G22/G29）
 * - `triggered` 是独立终态，finish 不折叠（G16）
 *
 * MIT License
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { getLogger } from '@modules/monitoring';
import { broadcastEvent } from '@modules/infrastructure';
import { resolveDataSubDir } from '@modules/core/paths';

const logger = getLogger('knowledge:compile-progress');

/** 9 个真实存在的编译阶段（顺序即执行顺序） */
export type CompilePhase =
  | 'scanning'
  | 'cleaning'
  | 'compiling'
  | 'linting'
  | 'graph_extract'
  | 'record_extract'
  | 'rule_extract'
  | 'chunk_refresh'
  | 'indexing';

export type PhaseStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'skipped'
  | 'triggered';

export type PhaseSkipReason =
  | 'gated'
  | 'busy'
  | 'memory'
  | 'truncated'
  | 'empty'
  | 'aborted';

export interface PhaseSnapshot {
  phase: CompilePhase;
  status: PhaseStatus;
  skipReason: PhaseSkipReason | null;
  startedAt: number | null;
  durationMs: number | null;
  detail: { current: number; total: number } | null;
}

/**
 * 已结束会话摘要（方案 B v7 修复：空闲态复盘）
 *
 * 背景：60s 复位会把 `status` 打回 `idle` 并清空 `phases[]`/`result`，
 * 导致前端空闲态看不到"上次编译结果"（方案 §4.1 的设计目标）。
 * 复位本身**不能取消** —— 陈旧的 `done` 会让新触发的编译被误判为"瞬间完成"
 * （useCompilePolling 已针对该竞态加固）。故用本独立字段承载历史，不动 `status` 语义。
 */
export interface CompileSessionSummary {
  sessionId: number;
  outcome: 'done' | 'aborted';
  finishedAt: number;
  durationMs: number;
  result: {
    compiled: number;
    skipped: number;
    errors: number;
    /** 前若干条错误文本（可观测性：前端可直接展示失败原因，无需翻日志） */
    errorSamples?: string[];
  } | null;
  lastError: string | null;
  /** 该次会话的 9 阶段终态快照（供流水线页空闲态复现 stepper） */
  phases: PhaseSnapshot[];
}

export interface CompileProgress {
  // ── 既有 6 字段（语义不变，前端 operationProgressStore 依赖）──
  status: 'idle' | 'compiling' | 'done';
  current: number;
  total: number;
  startedAt: number;
  lastError: string | null;
  result: {
    compiled: number;
    skipped: number;
    errors: number;
    /** 前若干条错误文本（可观测性） */
    errorSamples?: string[];
  } | null;
  // ── v7 新增 ──
  /** 会话序号：全局单调递增，60s 重置不归零（供 60s 重置做归属判断 + 前端跨会话去重） */
  sessionId: number;
  /** 广播序号：全局单调递增，60s 重置不归零（前端乱序去重） */
  seq: number;
  /** 当前阶段（= phases 中最后一个非 pending 的阶段） */
  phase: CompilePhase | null;
  /** 全 9 阶段快照（stepper 直接消费） */
  phases: PhaseSnapshot[];
  /** 上一次已结束会话的摘要（60s 复位不清除；每次会话结束时替换） */
  lastSession: CompileSessionSummary | null;
}

/** 阶段顺序表（与 §二 阶段模型一致） */
const PHASE_ORDER: readonly CompilePhase[] = [
  'scanning',
  'cleaning',
  'compiling',
  'linting',
  'graph_extract',
  'record_extract',
  'rule_extract',
  'chunk_refresh',
  'indexing',
] as const;

/** 阶段展示名（前端 label 兜底，前端可覆盖） */
const PHASE_LABELS: Record<CompilePhase, string> = {
  scanning: '扫描入料',
  cleaning: '清理孤儿产物',
  compiling: 'LLM 编译',
  linting: '质量检查',
  graph_extract: '图谱提取',
  record_extract: '字段级记录抽取',
  rule_extract: '规则抽取',
  chunk_refresh: '原文分块刷新',
  indexing: '索引与落账',
};

/** 合法状态迁移矩阵（§2.1） */
const LEGAL_TRANSITIONS: Record<PhaseStatus, readonly PhaseStatus[]> = {
  pending: ['running', 'skipped'],
  running: ['done', 'skipped', 'triggered'],
  done: [],
  skipped: [],
  triggered: [],
};

const BROADCAST_THROTTLE_MS = 500;
const RESET_DELAY_MS = 60000;
const SSE_EVENT_PHASE = 'knowledge:compile:phase';

/**
 * 已结束会话摘要的落盘位置
 * 懒解析（每次调用现算）：测试里 setUserDataDirOverride 之后才生效，
 * 避免模块加载期就把路径固定到真实用户数据目录。
 */
function lastSessionFilePath(): string {
  return join(resolveDataSubDir('knowledge'), 'compile-last-session.json');
}

/** 读取上次会话摘要；文件缺失/损坏时返回 null（不抛错） */
function loadLastSession(): CompileSessionSummary | null {
  try {
    const raw = readFileSync(lastSessionFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CompileSessionSummary>;
    if (
      typeof parsed.sessionId !== 'number' ||
      (parsed.outcome !== 'done' && parsed.outcome !== 'aborted') ||
      !Array.isArray(parsed.phases)
    ) {
      return null;
    }
    return parsed as CompileSessionSummary;
  } catch {
    // 文件不存在或不可解析：视为无历史摘要
    return null;
  }
}

/** 落盘上次会话摘要（best-effort：失败仅告警，绝不影响编译收尾） */
function persistLastSession(summary: CompileSessionSummary): void {
  try {
    const file = lastSessionFilePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(summary), 'utf-8');
  } catch (err) {
    logger.warning('上次编译会话摘要落盘失败', { error: String(err) });
  }
}

function createIdleProgress(): CompileProgress {
  return {
    status: 'idle',
    current: 0,
    total: 0,
    startedAt: 0,
    lastError: null,
    result: null,
    sessionId: 0,
    seq: 0,
    phase: null,
    phases: [],
    lastSession: null,
  };
}

// 启动时恢复上次会话摘要（仅历史复盘用；会话态本身不恢复）
let currentProgress: CompileProgress = {
  ...createIdleProgress(),
  lastSession: loadLastSession(),
};
/** 幂等收尾标记：abort 置位后 finish 直接 return（C7） */
let sessionTerminated = false;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;
let resetTimer: ReturnType<typeof setTimeout> | null = null;
let sessionCounter = 0;

function clonePhases(phases: PhaseSnapshot[]): PhaseSnapshot[] {
  return phases.map((p) => ({
    ...p,
    detail: p.detail ? { ...p.detail } : null,
  }));
}

function findPhase(phase: CompilePhase): PhaseSnapshot | undefined {
  return currentProgress.phases.find((p) => p.phase === phase);
}

/** 迁移校验：非法迁移仅告警不阻断（生产不因埋点崩掉编译） */
function assertLegal(
  from: PhaseStatus,
  to: PhaseStatus,
  phase: CompilePhase
): void {
  if (LEGAL_TRANSITIONS[from].includes(to)) return;
  logger.error('非法的阶段状态迁移', { phase, from, to });
}

/** 计时器 unref：UI 复位/节流定时器不应阻止进程退出（测试环境下尤为重要） */
function unrefTimer(t: ReturnType<typeof setTimeout>): void {
  const maybe = t as unknown as { unref?: () => void };
  maybe.unref?.();
}

/** 立即广播（状态迁移、终态） */
function broadcastImmediate(): void {
  if (throttleTimer) {
    clearTimeout(throttleTimer);
    throttleTimer = null;
  }
  emitPhaseEvent();
}

/** 节流广播（仅 detail 心跳） */
function broadcastThrottled(): void {
  if (throttleTimer) return;
  throttleTimer = setTimeout(() => {
    throttleTimer = null;
    emitPhaseEvent();
  }, BROADCAST_THROTTLE_MS);
  unrefTimer(throttleTimer);
}

function emitPhaseEvent(): void {
  currentProgress.seq += 1;
  const cp = currentProgress;
  const active =
    cp.phases.find((p) => p.status === 'running') ??
    cp.phases.find((p) => p.status === 'triggered') ??
    null;
  try {
    broadcastEvent(SSE_EVENT_PHASE, {
      sessionId: cp.sessionId,
      seq: cp.seq,
      phase: cp.phase,
      status: active?.status ?? (cp.status === 'done' ? 'done' : 'pending'),
      label: cp.phase ? PHASE_LABELS[cp.phase] : '',
      skipReason: active?.skipReason ?? null,
      startedAt: active?.startedAt ?? cp.startedAt,
      detail: active?.detail ?? null,
      current: cp.current,
      total: cp.total,
      // 全量快照：前端整体替换而非 patch（G11）
      phases: clonePhases(cp.phases),
      // 回归修复（2026-09-11，浏览器实测发现）：payload 缺 lastSession 时，
      // 前端"整体替换"会把上一会话摘要冲掉 → 空闲态文案退化为"本次编译刚结束"。
      // SSE 与 REST 快照字段必须一致。
      lastSession: cp.lastSession,
    });
  } catch (err) {
    // SSE 不可用不影响编译
    logger.warning('编译阶段事件广播失败', { error: String(err) });
  }
}

/** 收尾断言：会话终局不应残留 pending/running（G17/G22） */
export function assertPhasesSettled(trigger: 'finish' | 'abort'): void {
  const unsettled = currentProgress.phases.filter(
    (p) => p.status === 'pending' || p.status === 'running'
  );
  if (unsettled.length > 0) {
    logger.error('编译会话收尾时存在未 settle 的阶段', {
      trigger,
      unsettled: unsettled.map((p) => ({ phase: p.phase, status: p.status })),
      phases: clonePhases(currentProgress.phases),
    });
  }
}

/** 兜底收口：把 pending/running 统一置为 skipped（G22，abort 路径专用） */
export function settleUnfinishedStages(reason: PhaseSkipReason): void {
  let changed = false;
  for (const p of currentProgress.phases) {
    if (p.status === 'pending' || p.status === 'running') {
      p.status = 'skipped';
      p.skipReason = reason;
      p.durationMs = p.startedAt ? Date.now() - p.startedAt : null;
      changed = true;
    }
  }
  if (changed) broadcastImmediate();
}

function scheduleReset(capturedSessionId: number): void {
  if (resetTimer) clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    resetTimer = null;
    if (
      currentProgress.sessionId === capturedSessionId &&
      currentProgress.status === 'done'
    ) {
      // G24：只清会话态，sessionId/seq 保持单调不归零
      // 修复：lastSession 一并保留 —— 空闲态需要它复盘上次结果
      const { sessionId, seq, lastSession } = currentProgress;
      currentProgress = {
        ...createIdleProgress(),
        sessionId,
        seq,
        lastSession,
      };
    }
  }, RESET_DELAY_MS);
  unrefTimer(resetTimer);
}

/** 开始新一轮编译会话（替代 startCompileProgress） */
export function beginCompileSession(): void {
  sessionCounter += 1;
  sessionTerminated = false;
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }
  currentProgress = {
    status: 'compiling', // G29：显式复位，否则 abort 后的 finish 会被未启动守卫拦掉
    current: 0,
    total: 0,
    startedAt: Date.now(),
    lastError: null,
    result: null,
    sessionId: sessionCounter,
    seq: currentProgress.seq, // G24：不归零
    phase: null,
    // 修复：保留上次会话摘要（新会话进行中，前端仍可复盘上一次结果）
    lastSession: currentProgress.lastSession,
    phases: PHASE_ORDER.map((phase) => ({
      phase,
      status: 'pending' as PhaseStatus,
      skipReason: null,
      startedAt: null,
      durationMs: null,
      detail: null,
    })),
  };
  broadcastImmediate();
}

/** 扫描完成后回填文件总数 */
export function setSessionTotal(total: number): void {
  currentProgress.total = total;
}

/** 进入阶段（pending → running） */
export function enterPhase(
  phase: CompilePhase,
  detail?: { current: number; total: number }
): void {
  const target = findPhase(phase);
  if (!target) return;
  if (target.status !== 'pending') {
    logger.warning('阶段无法进入：当前状态不允许', {
      phase,
      status: target.status,
    });
    return;
  }
  assertLegal(target.status, 'running', phase);
  target.status = 'running';
  target.startedAt = Date.now();
  target.durationMs = null;
  target.skipReason = null;
  target.detail = detail ?? null;
  currentProgress.phase = phase;
  broadcastImmediate();
}

/** 更新阶段内进度（节流广播） */
export function updatePhaseDetail(current: number, total: number): void {
  const phase = currentProgress.phase;
  if (!phase) return;
  const target = findPhase(phase);
  if (!target || target.status !== 'running') return;
  target.detail = { current, total };
  // 顶层 current/total 保持"**文件级**"语义（既有契约 + useCompilePolling 的百分比依赖它）。
  // 阶段级 N/M 只写进 target.detail —— 否则 graph_extract 的页级计数（如 4/4）
  // 会覆盖文件级进度（1/1），顶栏百分比随之错乱。
  if (phase === 'compiling') {
    currentProgress.current = current;
    currentProgress.total = total > 0 ? total : currentProgress.total;
  }
  broadcastThrottled();
}

/** 完成当前阶段（running → done） */
export function completePhase(): void {
  const phase = currentProgress.phase;
  if (!phase) return;
  const target = findPhase(phase);
  if (!target || target.status !== 'running') return;
  target.status = 'done';
  target.durationMs = target.startedAt ? Date.now() - target.startedAt : null;
  currentProgress.phase = null;
  broadcastImmediate();
}

/** 跳过阶段（pending/running → skipped） */
export function skipPhase(phase: CompilePhase, reason: PhaseSkipReason): void {
  const target = findPhase(phase);
  if (!target) return;
  if (target.status !== 'pending' && target.status !== 'running') return;
  assertLegal(target.status, 'skipped', phase);
  target.status = 'skipped';
  target.skipReason = reason;
  target.durationMs = target.startedAt ? Date.now() - target.startedAt : null;
  if (currentProgress.phase === phase) currentProgress.phase = null;
  broadcastImmediate();
}

/** 标记为"已触发"终态（仅 indexing：异步旁路，不宣告 done） */
export function markTriggered(phase: CompilePhase): void {
  const target = findPhase(phase);
  if (!target || target.status !== 'running') return;
  assertLegal(target.status, 'triggered', phase);
  target.status = 'triggered';
  target.durationMs = target.startedAt ? Date.now() - target.startedAt : null;
  if (currentProgress.phase === phase) currentProgress.phase = null;
  broadcastImmediate();
}

/** 强制清空节流定时器并立即广播（终态前调用） */
export function flushPhaseBroadcast(): void {
  broadcastImmediate();
}

/**
 * 编译完成（唯一"完成"宣告点）
 * - 幂等：abort 已置位则直接返回（C7）
 * - 未启动保护：status !== 'compiling' 直接返回
 * - 只折叠 running → done，不碰 triggered（G16）
 */
export function finishCompileSession(result?: {
  compiled: number;
  skipped: number;
  errors: number;
  /** 前若干条错误文本（可观测性） */
  errorSamples?: string[];
}): void {
  if (sessionTerminated) return;
  if (currentProgress.status !== 'compiling') return;

  for (const p of currentProgress.phases) {
    if (p.status === 'running') {
      p.status = 'done';
      p.durationMs = p.startedAt ? Date.now() - p.startedAt : null;
    }
    // G16：triggered 保持独立终态，不折叠
  }
  currentProgress.status = 'done';
  currentProgress.result = result ?? null;
  currentProgress.phase = null;

  const durationMs = Date.now() - currentProgress.startedAt;
  // 修复：落一份"已结束会话摘要"，供 60s 复位后的空闲态复盘
  currentProgress.lastSession = {
    sessionId: currentProgress.sessionId,
    outcome: 'done',
    finishedAt: Date.now(),
    durationMs,
    result: result ?? null,
    lastError: null,
    phases: clonePhases(currentProgress.phases),
  };
  persistLastSession(currentProgress.lastSession);
  broadcastImmediate();
  assertPhasesSettled('finish');
  try {
    broadcastEvent('knowledge:compile:completed', {
      total: currentProgress.total,
      result,
      durationMs,
    });
  } catch (err) {
    logger.warning('编译完成事件广播失败', { error: String(err) });
  }
  scheduleReset(currentProgress.sessionId);
}

/**
 * 编译异常中止（与 finish 对称：settle + 断言 + 60s 重置）
 */
export function abortCompileProgress(error: string): void {
  if (sessionTerminated) return;
  settleUnfinishedStages('aborted'); // 先收口，便于断言只报真实残留
  currentProgress.status = 'done';
  currentProgress.lastError = error;
  currentProgress.phase = null;
  sessionTerminated = true;
  // 修复：中止同样落摘要（outcome='aborted'），空闲态可见失败原因
  currentProgress.lastSession = {
    sessionId: currentProgress.sessionId,
    outcome: 'aborted',
    finishedAt: Date.now(),
    durationMs: Date.now() - currentProgress.startedAt,
    result: currentProgress.result,
    lastError: error,
    phases: clonePhases(currentProgress.phases),
  };
  persistLastSession(currentProgress.lastSession);
  broadcastImmediate();
  assertPhasesSettled('abort');
  try {
    broadcastEvent('knowledge:compile:aborted', { error });
  } catch (err) {
    logger.warning('编译中止事件广播失败', { error: String(err) });
  }
  scheduleReset(currentProgress.sessionId);
}

/** 获取当前进度（供 HTTP 端点使用，深拷贝防外部改写） */
export function getCompileProgress(): CompileProgress {
  return {
    ...currentProgress,
    phases: clonePhases(currentProgress.phases),
  };
}
