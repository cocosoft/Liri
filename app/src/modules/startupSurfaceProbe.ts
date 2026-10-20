/**
 * startupSurfaceProbe.ts — 内核瘦身 **P0 取证件**（2026-10-20，`内核瘦身-方案.md` §P0）
 *
 * 产出（一份基线报告）：
 *   ① 启动耗时分段（T0 预读取 / T1 必需模块 / T1 预取等待 / T2 模式分发 / T3 后台批次窗口）；
 *   ② 启动完成后的**模块清单**（按 `LazyModuleStrategy` 分级：critical / deferred-batch /
 *      deferred-on-demand，含各自初始化偏移与耗时）；
 *   ③ **可观测的**「首次使用时间」：仅 `ON_DEMAND` 模块可得（首次 `requestModule` 时
 *      `profilePhaseStart('on_demand:<id>')` 留下 mark）；批次模块的"是否真被业务调用"**不可观测**，
 *      本报告只记录它已付出的初始化成本（见 `REPORT_NOTES`，不臆造）。
 *
 * 为什么不新建一套计时机制（CS01）：
 *   - 分段与每模块耗时**直接复用**既有 `performance.mark`（`StartupProfiler` 与
 *     `ModuleInitializer` 已经在打点：`launch_start` / `T0_preroll_*` / `module_init_*` /
 *     `T1_await_prefetch_*` / `T2_dispatch_*` / `init:<id>` / `deferred:<id>` / `on_demand:<id>`）；
 *   - 模块状态直接读 `ModuleInitializer.getAllModuleStates()` 与 `deferredLoader.getStates()`。
 *   ⇒ 本文件只做**读取 + 汇总 + 落盘**，不改任何加载行为。
 *
 * 开关：`LIRI_STARTUP_REPORT=1`（默认关 ⇒ 零额外 I/O、零行为变更）。
 * 落盘：`{dataDir}/startup-surface/startup-surface-{ts}.json`
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveDataDir } from '@modules/core';
import {
  deferredLoader,
  getDeferredModuleIds,
  getEssentialModuleIds,
  getOnDemandModuleIds,
} from '@modules/core/LazyModuleStrategy';
import { getLogger } from '../core/loggerFacade.js';
import { MODULE_INITIALIZATION_ORDER } from './ModuleDefinitions';
// 复用 `ModuleInitializer` 的**状态联合类型**（不在此重写一份词汇表；状态字面量棘轮口）

import type {
  ModuleInitializationState,
  ModuleStateLike,
} from './ModuleInitializer.js';

/** 复用类型所有者导出的结构子集（不在此重写状态词汇） */
export type { ModuleStateLike };

const logger = getLogger('modules:startupSurfaceProbe');

/** 报告格式版本 */
export const STARTUP_SURFACE_REPORT_VERSION = 1;

/** 观察窗口（秒）—— 等 T3 批次落定 / HTTP 就绪的上限 */
const STARTUP_SURFACE_WINDOW_SECONDS = 15;

/** 轮询间隔（毫秒） */
const PROBE_POLL_INTERVAL = 200;

/** 报告里必须如实写明的边界（不臆造"使用"） */
export const REPORT_NOTES: readonly string[] = [
  'T3 批次模块（deferred-batch）的 firstUseOffsetMs 记为 null：批量初始化在启动后固定发生，"是否真被业务调用"无法由本探针观测 —— 该判定只能靠 P1b 逐模块降级实验，本报告只记录它已付出的初始化成本。',
  '模块偏移由 ModuleInitializer 的 Date.now() 状态换算到 performance.timeOrigin，与 performance marks 之间存在毫秒级时钟差（同一进程内两套时钟）。',
  'preLaunchOffsetMs（进程启动 → launch_start）= 静态模块求值耗时，不在 segments 内；http-only / daemon / headless 模式下 T2_dispatch_end 永不打点（常驻不返回）⇒ T2 段缺席属正常，不补 0。',
  'RSS 仅作参考（D1：主指标是模块数，RSS 受 GC / 平台分配器影响，跨次波动不可作为"是否变轻"的判据）。',
];

/** 模块分级 */
export type ModuleTier = 'critical' | 'deferred-batch' | 'deferred-on-demand';

/** 单个模块的启动面记录 */
export interface StartupModuleEntry {
  moduleId: string;
  tier: ModuleTier;
  /**
   * 初始化状态（沿用 `ModuleInitializer` 的联合类型）
   *
   * `null` = **未注册 / 尚未开始**（探针不会把它说成"pending"——那是另一套状态词汇，
   * 会把"没有记录"和"正在等"混为一谈）。
   */
  status: ModuleInitializationState['status'] | null;
  /** 首次初始化开始时刻（相对进程启动，ms）；未开始 ⇒ null */
  initStartOffsetMs: number | null;
  /** 初始化耗时（ms）；未完成 ⇒ null */
  initDurationMs: number | null;
  /**
   * 首次使用时刻（相对进程启动，ms）
   *
   * 仅 `deferred-on-demand` 可观测（首次 `requestModule`）；其余为 null。
   * 注意：**null 不等于"未使用"** —— 批次模块无从观测（见 `REPORT_NOTES`）。
   */
  firstUseOffsetMs: number | null;
  /** 该模块的"使用"是否可被本探针观测 */
  usageObservable: boolean;
  /** 初始化失败信息（仅 error） */
  error?: string;
}

/** 启动分段 */
export interface StartupSegment {
  /** 语义名，如 `T0 预读取` */
  label: string;
  /** 起始偏移（相对进程启动，ms） */
  startOffsetMs: number;
  /** 耗时（ms） */
  durationMs: number;
}

/** 汇总计数（D1 主指标 = `initialized`；按分级的已加载数分列，避免"启动前/后"的时钟歧义） */
export interface StartupSurfaceCounts {
  total: number;
  /** 分级总数 */
  critical: number;
  deferredBatch: number;
  deferredOnDemand: number;
  /** 已初始化总数（= D1 的"启动后已加载模块数"） */
  initialized: number;
  /** 其中：CRITICAL（启动面）已初始化 */
  initializedCritical: number;
  /** 其中：T3 批次已初始化 */
  initializedBatch: number;
  /** 其中：ON_DEMAND 已加载（⇒ 必有一次首次请求） */
  initializedOnDemand: number;
  /** ON_DEMAND 中已被首次请求的数量（`firstUseOffsetMs !== null`） */
  requestedOnDemand: number;
  initializing: number;
  /** 既无记录也未开始（≠ 失败，也 ≠ "正在等"） */
  notStarted: number;
  error: number;
}

/** 基线报告 */
export interface StartupSurfaceReport {
  v: number;
  generatedAt: string;
  process: {
    pid: number;
    platform: string;
    runtime: string;
    uptimeSeconds: number;
  };
  memory: { rssMb: number; heapUsedMb: number };
  /** HTTP 就绪时刻（相对进程启动，ms）；未观测到 ⇒ null */
  readyAtOffsetMs: number | null;
  /**
   * 进程启动 → `launch_start` 的耗时（ms）= **静态模块求值**
   *
   * 这段不在 `segments` 里（marks 从 `launch_start` 才开始打点），但它是启动成本的大头之一
   * （实测基线约 1.6s），故单列。
   */
  preLaunchOffsetMs: number | null;
  segments: StartupSegment[];
  deferredWindow: {
    startOffsetMs: number | null;
    endOffsetMs: number | null;
    durationMs: number | null;
  };
  counts: StartupSurfaceCounts;
  modules: StartupModuleEntry[];
  notes: readonly string[];
}

/** `performance.mark` 的最小结构（便于单测注入） */
export interface MarkLike {
  name: string;
  startTime: number;
}

/** 分段定义：name 必须与 `main.ts` / `ModuleInitializer` 现有打点一致 */
const SEGMENT_DEFINITIONS: ReadonlyArray<{
  label: string;
  from: string;
  to: string;
}> = [
  { label: 'T0 预读取', from: 'launch_start', to: 'T0_preroll_end' },
  {
    label: 'T1 必需模块初始化',
    from: 'module_init_start',
    to: 'module_init_end',
  },
  {
    label: 'T1 预取等待',
    from: 'T1_await_prefetch_start',
    to: 'T1_await_prefetch_end',
  },
  { label: 'T2 模式分发', from: 'T2_dispatch_start', to: 'T2_dispatch_end' },
];

/** 是否启用取证件（`LIRI_STARTUP_REPORT=1` / `true`） */
export function isStartupSurfaceReportEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = (env['LIRI_STARTUP_REPORT'] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

/** 从 marks 建分段（缺失任一端 ⇒ 该段不出现，不臆造 0） */
export function buildStartupSegments(
  marks: readonly MarkLike[]
): StartupSegment[] {
  const byName = new Map(marks.map((m) => [m.name, m.startTime]));
  const segments: StartupSegment[] = [];
  for (const def of SEGMENT_DEFINITIONS) {
    const from = byName.get(def.from);
    const to = byName.get(def.to);
    if (from === undefined || to === undefined || to < from) continue;
    segments.push({
      label: def.label,
      startOffsetMs: roundMs(from),
      durationMs: roundMs(to - from),
    });
  }
  return segments;
}

/** T3 批次窗口：全部 `deferred:*` 打点里最早 start → 最晚 end */
export function buildDeferredWindow(marks: readonly MarkLike[]): {
  startOffsetMs: number | null;
  endOffsetMs: number | null;
  durationMs: number | null;
} {
  let start: number | undefined;
  let end: number | undefined;
  for (const mark of marks) {
    if (!mark.name.startsWith('deferred:')) continue;
    if (mark.name.endsWith('_start')) {
      start =
        start === undefined ? mark.startTime : Math.min(start, mark.startTime);
    } else if (mark.name.endsWith('_end')) {
      end = end === undefined ? mark.startTime : Math.max(end, mark.startTime);
    }
  }
  if (start === undefined || end === undefined) {
    return { startOffsetMs: null, endOffsetMs: null, durationMs: null };
  }
  return {
    startOffsetMs: roundMs(start),
    endOffsetMs: roundMs(end),
    durationMs: roundMs(end - start),
  };
}

/** 模块 ID → 分级（三个 getter 同源于 `LAZY_MODULE_STRATEGY`） */
export function classifyModuleTiers(
  order: readonly string[] = MODULE_INITIALIZATION_ORDER
): Map<string, ModuleTier> {
  const tiers = new Map<string, ModuleTier>();
  for (const id of getEssentialModuleIds([...order])) {
    tiers.set(id, 'critical');
  }
  for (const id of getDeferredModuleIds([...order])) {
    tiers.set(id, 'deferred-batch');
  }
  for (const id of getOnDemandModuleIds([...order])) {
    tiers.set(id, 'deferred-on-demand');
  }
  return tiers;
}

/**
 * 构建模块清单
 *
 * @param tiers      `classifyModuleTiers()` 的结果
 * @param states     `ModuleInitializer.getAllModuleStates()`
 * @param marks      performance marks（用于 ON_DEMAND 首次使用）
 * @param originWall 进程启动的墙钟时刻（`performance.timeOrigin` 或等价换算）
 */
export function buildModuleSurface(input: {
  order: readonly string[];
  tiers: ReadonlyMap<string, ModuleTier>;
  states: Readonly<Record<string, ModuleStateLike>>;
  marks: readonly MarkLike[];
  originWall: number;
}): StartupModuleEntry[] {
  const byName = new Map(input.marks.map((m) => [m.name, m.startTime]));
  return input.order.map((moduleId) => {
    const tier = input.tiers.get(moduleId) ?? 'critical';
    const state = input.states[moduleId];
    const startOffset =
      state?.startTime !== undefined
        ? roundMs(state.startTime - input.originWall)
        : null;
    const duration =
      state?.startTime !== undefined && state?.endTime !== undefined
        ? roundMs(state.endTime - state.startTime)
        : null;
    const usageObservable = tier === 'deferred-on-demand';
    const firstUse = usageObservable
      ? (byName.get(`on_demand:${moduleId}_start`) ?? null)
      : null;
    const entry: StartupModuleEntry = {
      moduleId,
      tier,
      status: state?.status ?? null,
      initStartOffsetMs: startOffset,
      initDurationMs: duration,
      firstUseOffsetMs: firstUse === null ? null : roundMs(firstUse),
      usageObservable,
    };
    if (state?.error) entry.error = state.error.message;
    return entry;
  });
}

/** 汇总计数 */
export function summarizeSurface(
  modules: readonly StartupModuleEntry[]
): StartupSurfaceCounts {
  const counts: StartupSurfaceCounts = {
    total: modules.length,
    critical: 0,
    deferredBatch: 0,
    deferredOnDemand: 0,
    initialized: 0,
    initializedCritical: 0,
    initializedBatch: 0,
    initializedOnDemand: 0,
    requestedOnDemand: 0,
    initializing: 0,
    notStarted: 0,
    error: 0,
  };
  for (const m of modules) {
    if (m.tier === 'critical') counts.critical++;
    else if (m.tier === 'deferred-batch') counts.deferredBatch++;
    else counts.deferredOnDemand++;

    // 判定用**时间戳 + error 存在性**，不再比较状态字符串（避免在本文件新增状态字面量）
    if (m.error !== undefined) {
      counts.error++;
    } else if (m.initDurationMs !== null) {
      counts.initialized++;
      if (m.tier === 'critical') counts.initializedCritical++;
      else if (m.tier === 'deferred-batch') counts.initializedBatch++;
      else counts.initializedOnDemand++;
    } else if (m.initStartOffsetMs !== null) {
      counts.initializing++;
    } else {
      counts.notStarted++;
    }

    if (m.tier === 'deferred-on-demand' && m.firstUseOffsetMs !== null) {
      counts.requestedOnDemand++;
    }
  }
  return counts;
}

/** 组装完整报告（纯函数；IO 只在 `scheduleStartupSurfaceReport` 里） */
export function buildStartupSurfaceReport(input: {
  order?: readonly string[];
  states: Readonly<Record<string, ModuleStateLike>>;
  marks: readonly MarkLike[];
  originWall: number;
  readyAtOffsetMs: number | null;
  memory: { rss: number; heapUsed: number };
  uptimeSeconds: number;
}): StartupSurfaceReport {
  const order = input.order ?? MODULE_INITIALIZATION_ORDER;
  const tiers = classifyModuleTiers(order);
  const modules = buildModuleSurface({
    order,
    tiers,
    states: input.states,
    marks: input.marks,
    originWall: input.originWall,
  });
  const segments = buildStartupSegments(input.marks);
  const launchStart = input.marks.find((m) => m.name === 'launch_start');

  return {
    v: STARTUP_SURFACE_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    process: {
      pid: process.pid,
      platform: process.platform,
      runtime: `bun ${process.versions.bun ?? 'unknown'}`,
      uptimeSeconds: roundMs(input.uptimeSeconds),
    },
    memory: {
      rssMb: roundMb(input.memory.rss),
      heapUsedMb: roundMb(input.memory.heapUsed),
    },
    readyAtOffsetMs: input.readyAtOffsetMs,
    preLaunchOffsetMs:
      launchStart === undefined ? null : roundMs(launchStart.startTime),
    segments,
    deferredWindow: buildDeferredWindow(input.marks),
    counts: summarizeSurface(modules),
    modules,
    notes: REPORT_NOTES,
  };
}

/**
 * 调度一次启动面取件（在 T3 批次调度之后调用）
 *
 * 默认关闭；开启后等"批次落定 + HTTP 就绪"（上限 15s）再落盘，**不阻塞启动**。
 */
export function scheduleStartupSurfaceReport(): void {
  if (!isStartupSurfaceReportEnabled()) return;
  void collectAndWrite().catch((err: unknown) => {
    logger.warning('启动面基线采集失败（不影响启动）', { error: String(err) });
  });
}

async function collectAndWrite(): Promise<void> {
  const originWall = readTimeOriginWall();
  const waitStartedAt = Date.now();
  const deadline = waitStartedAt + STARTUP_SURFACE_WINDOW_SECONDS * 1000;
  let readyAtOffsetMs: number | null = null;

  // 等：① 批次全部落定 ② HTTP 就绪（`LIRI_HTTP_STARTED` 由 main.ts 既有逻辑设置）
  while (Date.now() < deadline) {
    if (readyAtOffsetMs === null && process.env['LIRI_HTTP_STARTED'] === '1') {
      readyAtOffsetMs = roundMs(Date.now() - originWall);
    }
    if (deferredLoader.getPendingCount() === 0 && readyAtOffsetMs !== null)
      break;
    await sleep(PROBE_POLL_INTERVAL);
  }

  const { moduleInitializer } = await import('./ModuleInitializer.js');
  const report = buildStartupSurfaceReport({
    states: moduleInitializer.getAllModuleStates() as unknown as Record<
      string,
      ModuleStateLike
    >,
    marks: readMarks(),
    originWall,
    readyAtOffsetMs,
    memory: process.memoryUsage(),
    uptimeSeconds: process.uptime(),
  });

  const filePath = writeReport(report);
  const { counts } = report;
  logger.info(
    `启动面基线：模块 ${counts.total}（critical ${counts.critical} / batch ${counts.deferredBatch} / on-demand ${counts.deferredOnDemand}），` +
      `已加载 ${counts.initialized}（critical ${counts.initializedCritical} / batch ${counts.initializedBatch} / on-demand ${counts.initializedOnDemand}），` +
      `静态求值 ${report.preLaunchOffsetMs ?? 0}ms，T3 批次 ${report.deferredWindow.durationMs ?? 0}ms，RSS ${report.memory.rssMb}MB`,
    { reportFile: filePath }
  );
}

/** 落盘并返回路径 */
export function writeReport(report: StartupSurfaceReport): string {
  const dir = join(resolveDataDir(), 'startup-surface');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `startup-surface-${Date.now()}.json`);
  writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
  return filePath;
}

function readMarks(): MarkLike[] {
  const entries = performance.getEntriesByType('mark') as PerformanceMark[];
  return entries.map((e) => ({ name: e.name, startTime: e.startTime }));
}

function readTimeOriginWall(): number {
  const origin = performance.timeOrigin;
  if (Number.isFinite(origin) && origin > 0) return origin;
  // 退化路径（无 timeOrigin 的运行时）：用 uptime 反推进程启动墙钟
  return Date.now() - process.uptime() * 1000;
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
