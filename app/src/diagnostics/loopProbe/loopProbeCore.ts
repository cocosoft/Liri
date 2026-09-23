// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 事件循环阻塞探针 · 决策核心与 profile 摘要（P1，2026-09-22）
 *
 * **纯函数区**：不触碰 inspector / fs / 日志，便于用"假 lag 序列"做确定性回归
 * （方案 §5 验证要求："注入假 lag 序列 ⇒ 断言第一次不转储、第二次转储"）。
 *
 * 触发策略 **D-P1 ①「守株待兔」**：阻塞在本实例上高频重复（实测 562 次 / 11 天，
 * 密集期每 10–20 分钟一次），因此**不需要全局常开 profiler** ——
 * 检测到第一次阻塞后 `arm`（启动 profiler），等**下一次**阻塞落进采样窗口再 `dump`；
 * 若 arm 后超时仍未等到，则丢弃该份并回到待命（内存有界）。
 */

/** 探针档位：`off` 完全不动作；`p1` 阶段标签 + CPU profile 转储（阶段标签见 phaseStack） */
export type ProbeMode = 'off' | 'p1';

export function resolveProbeMode(
  env: Record<string, string | undefined> = process.env
): ProbeMode {
  const raw = (env['LOOP_PROBE'] ?? '').trim().toLowerCase();
  return raw === 'off' ? 'off' : 'p1'; // 缺省 p1（D-P6 ①：该问题已持续 11 天、用户可见）
}

export interface ProbeConfig {
  /** 命中的 lag 阈值（ms）：低于此值视为正常抖动，不参与状态迁移 */
  lagThresholdMs: number;
  /**
   * arm 后等待下一次阻塞的上限（ms）：超时即丢弃并回待命。
   *
   * **2026-09-22 实测收紧（20min → 60s）**：profiler 在 Bun 的常开开销 ~**5–7% 单核**
   * （实测：5ms 采样 7.34% / 10ms 5.00% / 20ms 5.86% / 50ms 7.10% —— **与采样间隔无单调关系**，
   * 属 `node:inspector` 引擎插桩的固定成本，非采样频率所致）。
   * 故 armed 时长必须短：真机观测到 burst 期阻塞**每 28s 一次** ⇒ 60s 窗口足以命中；
   * 未命中时只损失约 60s × 6% ≈ 3.6s CPU，且**每次新的阻塞都会重新 arm**。
   * 长跑均值 ≈（阻塞频率 × 60s × 6%）⇒ 10 分钟一次的频率下约 **0.6%**。
   */
  armTimeoutMs: number;
  /**
   * 单进程最多转储份数：达到后永久关闭（一次性探针，D-P7 ①）。
   *
   * 2026-09-22 由 3 提到 **5**：取证验收要求"≥5 次一致归因"，单进程内即可满足。
   */
  maxDumps: number;
  /**
   * CPU 采样间隔（µs）。**注意：它几乎不影响开销**（见 `armTimeoutMs` 实测），
   * 故取 10ms —— 40s 阻塞仍可采到约 4000 点，足够分辨热点函数。
   */
  samplingIntervalUs: number;
}

export const DEFAULT_PROBE_CONFIG: ProbeConfig = {
  lagThresholdMs: 3000,
  armTimeoutMs: 60_000,
  maxDumps: 5,
  samplingIntervalUs: 10_000,
};

export interface ProbeState {
  /** `idle` 待命 / `armed` 已启动 profiler 等下一次阻塞 / `closed` 已用尽份数 */
  phase: 'idle' | 'armed' | 'closed';
  /** 已完成转储份数 */
  dumps: number;
  /** 本次 arm 的时刻（epoch ms），未 armed 时为 0 */
  armedAt: number;
  /** 触发本次 arm 的 lag（ms），写入报告用于对照 */
  armLagMs: number;
}

export function initProbeState(): ProbeState {
  return { phase: 'idle', dumps: 0, armedAt: 0, armLagMs: 0 };
}

export type ProbeAction = 'none' | 'arm' | 'dump' | 'discard';

export interface ProbeDecision {
  state: ProbeState;
  action: ProbeAction;
}

/**
 * 收到一次"真实阻塞"（已排除睡眠唤醒）时的迁移。
 *
 * - `idle` → `arm`：启动 profiler，等下一次阻塞；
 * - `armed` → `dump`：把**当前** profile 转储（其采样窗口覆盖了刚结束的这次阻塞）；
 *   若本次用尽份数 ⇒ 同步置 `closed`（转储动作仍已发生）。
 */
export function decideOnLag(
  state: ProbeState,
  lagMs: number,
  at: number,
  cfg: ProbeConfig = DEFAULT_PROBE_CONFIG
): ProbeDecision {
  if (lagMs < cfg.lagThresholdMs) return { state, action: 'none' };
  if (state.phase === 'closed') return { state, action: 'none' };

  if (state.phase === 'idle') {
    return {
      state: {
        phase: 'armed',
        dumps: state.dumps,
        armedAt: at,
        armLagMs: lagMs,
      },
      action: 'arm',
    };
  }

  // armed：下一次阻塞到达 ⇒ 转储
  const nextDumps = state.dumps + 1;
  return {
    state: {
      phase: nextDumps >= cfg.maxDumps ? 'closed' : 'idle',
      dumps: nextDumps,
      armedAt: 0,
      armLagMs: state.armLagMs,
    },
    action: 'dump',
  };
}

/** arm 超时检查（由 `loopProbe` 的 unref 定时器驱动）：超时即丢弃该份，回到待命 */
export function decideOnArmTimeout(
  state: ProbeState,
  at: number,
  cfg: ProbeConfig = DEFAULT_PROBE_CONFIG
): ProbeDecision {
  if (state.phase !== 'armed') return { state, action: 'none' };
  if (at - state.armedAt < cfg.armTimeoutMs) return { state, action: 'none' };
  return {
    state: { phase: 'idle', dumps: state.dumps, armedAt: 0, armLagMs: 0 },
    action: 'discard',
  };
}

/* ------------------------------------------------------------------ *
 * profile 摘要（纯计算）
 * ------------------------------------------------------------------ */

export interface CpuProfileNodeLike {
  id: number;
  callFrame: {
    functionName?: string;
    url?: string;
    lineNumber?: number;
  };
}

export interface CpuProfileLike {
  nodes: CpuProfileNodeLike[];
  samples?: number[];
  timeDeltas?: number[];
}

export interface ProfileHotspot {
  fn: string;
  url: string;
  line: number;
  ms: number;
  pct: number;
}

export interface ProfileSummary {
  /** 采样覆盖时长（ms）= Σ timeDeltas */
  totalMs: number;
  sampleCount: number;
  /** 自身耗时最高的函数（self time，已按 functionName+url+line 聚合） */
  top: ProfileHotspot[];
  /** GC 帧占比（%）—— 用于判"B. GC/分配"类 */
  gcPct: number;
  /** 采样占比最高的文件（前 5）——用于一眼看出"哪一层在吃 CPU" */
  topFiles: Array<{ file: string; ms: number; pct: number }>;
}

/**
 * 计算 profile 的热点摘要。
 *
 * self time 口径：`samples[i]` 指向**当时正在执行**的节点，`timeDeltas[i]` 是该采样点与
 * 上一点的时间差 ⇒ 按节点累加即得自身耗时（不含子调用），这正是"谁在吃 CPU"的答案。
 */
export function summarizeProfile(profile: CpuProfileLike): ProfileSummary {
  const byId = new Map<number, CpuProfileNodeLike>();
  for (const node of profile.nodes) byId.set(node.id, node);

  const selfMsById = new Map<number, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  let totalMs = 0;
  for (let i = 0; i < samples.length; i++) {
    const dtUs = deltas[i] ?? 0;
    const dtMs = dtUs / 1000;
    totalMs += dtMs;
    const id = samples[i];
    selfMsById.set(id, (selfMsById.get(id) ?? 0) + dtMs);
  }

  const agg = new Map<string, ProfileHotspot>();
  const fileAgg = new Map<string, number>();
  let gcMs = 0;

  for (const [id, ms] of selfMsById) {
    const frame = byId.get(id)?.callFrame;
    const fn = frame?.functionName || '(anonymous)';
    const url = frame?.url || '(unknown)';
    const line = (frame?.lineNumber ?? -1) + 1;
    const key = `${fn}|${url}|${line}`;
    const prev = agg.get(key);
    if (prev) prev.ms += ms;
    else agg.set(key, { fn, url, line, ms, pct: 0 });
    if (isGcFrame(fn, url)) gcMs += ms;
    const fileKey = url || '(unknown)';
    fileAgg.set(fileKey, (fileAgg.get(fileKey) ?? 0) + ms);
  }

  const pct = (ms: number): number =>
    totalMs > 0 ? +((ms / totalMs) * 100).toFixed(1) : 0;

  const top = [...agg.values()]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 20)
    .map((h) => ({ ...h, pct: pct(h.ms) }));

  const topFiles = [...fileAgg.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([file, ms]) => ({ file, ms: Math.round(ms), pct: pct(ms) }));

  return {
    totalMs: Math.round(totalMs),
    sampleCount: samples.length,
    top: top.map((h) => ({ ...h, ms: Math.round(h.ms) })),
    gcPct: pct(gcMs),
    topFiles,
  };
}

/** GC / 运行时的内部帧（不同引擎命名不一，一并归入 B 类判据） */
function isGcFrame(fn: string, url: string): boolean {
  const f = fn.toLowerCase();
  if (f.includes('garbage collector') || f === '(garbage collector)')
    return true;
  if (f === '(program)' || f === '(idle)') return true;
  return url === '' && f.includes('gc');
}
