/**
 * 内存画像采样助手（2026-09-02 排查"会话中断/内存尖峰"用）
 *
 * 背景：agentic 运行期出现 RSS 瞬时尖峰（2-4.4GB、heapTotal 膨胀至 2.4GB 而
 * heapUsed<1GB）与 Event Loop GC STW 最长 13.9s。为定位瞬时大分配源，在关键
 * 管线点（上下文构建/压缩评估/快照读取/图谱提取）加采样。
 *
 * 用法：MEM_PROFILE=1 时打日志（module=chat:mem-profile），否则零开销早退。
 *   MEM_PROFILE=1 bun run src/main.ts ...
 */
import { getLogger } from './index';
import { getMemoryPressureMonitor } from './memoryPressure/MemoryPressureMonitor.js';
import { configManager } from '@openliri/infra/config';
import { MS_PER_SECOND } from '@openliri/infra/constants';

// 经统一出入口（R05-012）
const MEM_PROFILE_ENABLED = configManager.env('MEM_PROFILE') === '1';

/**
 * P2-1（2026-11-04）：同一采样点的最小落日志间隔。
 *
 * 实测 44 分钟内 `memProfile:*` 521 条（热点管线每轮都打），其中绝大多数是同一批点的
 * 重复快照。改为**按点限流**：窗口内只保留一条，其余计数、并在下一条放行时带上
 * `suppressed`（信息量不减，条数受控）。数值口径：5 秒。
 */
const MEM_PROFILE_POINT_MIN_INTERVAL = 5 * MS_PER_SECOND;

// R11-001（2026-09-24）：改用零样板门面 getLogger(module) —— 默认 INFO/json 形态，
// 与原显式构造等价且复用单例；禁止直接构造 Logger 实例。
const logger = getLogger('chat:mem-profile');

/**
 * 采样激活：MEM_PROFILE=1（诊断跑批）**或**内存水位 ≥L0（2026-09-02 复查执行
 * §3.1/§3.4：压力期自动升级为逐点采样，无需重启带 MEM_PROFILE）。
 */
function samplingActive(): boolean {
  return MEM_PROFILE_ENABLED || getMemoryPressureMonitor().currentLevel() >= 1;
}

/** 每个采样点的最近一次放行时间与被抑制条数（P2-1 限流状态） */
const pointEmitState = new Map<string, { at: number; suppressed: number }>();

/**
 * A4（2026-11-05）：RSS 基线告警口径（**不用固定阈值**，以启动稳态为基线）。
 *
 * - 暖机 60s（毫秒）：进程启动初期 RSS 尚在爬升，此窗口内的采样只用于确定起点；
 * - 基线 = 暖机结束后**首个**采样值（每进程重新采纳，进程重启即重置）；
 * - 告警需**同时**满足「≥ 基线 ×1.5」与「绝对增量 ≥ 256MB」——只用比例会在小内存进程上
 *   过于敏感，只用绝对值又无法跨机器比较，故两者取与；
 * - 冷却 10 分钟（毫秒）：同一轮上涨只提示一次，避免刷屏。
 */
const RSS_BASELINE_THRESHOLDS = {
  graceMs: 60 * MS_PER_SECOND,
  multiplier: 1.5,
  minDeltaMb: 256,
  cooldownMs: 10 * 60 * MS_PER_SECOND,
} as const;

/** RSS 基线状态（纯函数入参/出参，便于单测） */
export interface RssBaselineState {
  /** 已采纳的启动稳态基线（MB）；`null` = 尚未采纳 */
  baselineMb: number | null;
  /** 首次采样时刻（暖机窗口起点）；0 = 尚未开始 */
  firstSampleAt: number;
  /** 上次告警时刻；0 = 从未告警 */
  lastAlertAt: number;
}

export interface RssBaselineThresholds {
  graceMs: number;
  multiplier: number;
  minDeltaMb: number;
  cooldownMs: number;
}

export type RssBaselineAction = 'warmup' | 'adopted' | 'alert' | 'ok';

/**
 * A4：RSS 基线判定（纯函数）。
 *
 * `warmup` 暖机中 / `adopted` 本轮采纳基线 / `alert` 超基线且过冷却 / `ok` 其余。
 */
export function evaluateRssBaseline(
  state: RssBaselineState,
  currentMb: number,
  now: number,
  thresholds: RssBaselineThresholds = RSS_BASELINE_THRESHOLDS
): {
  action: RssBaselineAction;
  next: RssBaselineState;
  ratio?: number;
  deltaMb?: number;
} {
  if (state.baselineMb === null) {
    const firstSampleAt = state.firstSampleAt || now;
    if (now - firstSampleAt < thresholds.graceMs) {
      return { action: 'warmup', next: { ...state, firstSampleAt } };
    }
    return {
      action: 'adopted',
      next: { ...state, firstSampleAt, baselineMb: currentMb },
    };
  }

  const baseline = state.baselineMb;
  const ratio = baseline > 0 ? currentMb / baseline : 1;
  const deltaMb = currentMb - baseline;
  const overRatio = ratio >= thresholds.multiplier;
  const overDelta = deltaMb >= thresholds.minDeltaMb;
  if (!overRatio || !overDelta) {
    return { action: 'ok', next: state, ratio, deltaMb };
  }
  // `lastAlertAt === 0` = 从未告警（不能按"60s 前告过警"算，否则首轮永远被冷却吞掉）
  if (
    state.lastAlertAt > 0 &&
    now - state.lastAlertAt < thresholds.cooldownMs
  ) {
    return { action: 'ok', next: state, ratio, deltaMb };
  }
  return { action: 'alert', next: { ...state, lastAlertAt: now }, ratio, deltaMb };
}

/** 运行期基线状态（模块级；每进程一份） */
let rssBaselineState: RssBaselineState = {
  baselineMb: null,
  firstSampleAt: 0,
  lastAlertAt: 0,
};

/**
 * A4：基线检查的全局最小间隔。
 *
 * `memProfile()` 是热点管线（每轮对话多点调用），而 `process.memoryUsage()` 不便宜；
 * 基线告警无需逐点精度，故整体 30s 一次即可，既保住"不受 MEM_PROFILE 开关影响"，
 * 又不把诊断关闭时的零开销退化成每次调用都取样。
 */
const RSS_BASELINE_CHECK_MIN_INTERVAL = 30 * MS_PER_SECOND;

let lastRssBaselineCheckAt = 0;

/** 仅测试用：复位 RSS 基线状态 */
export function resetRssBaselineForTest(): void {
  rssBaselineState = { baselineMb: null, firstSampleAt: 0, lastAlertAt: 0 };
  lastRssBaselineCheckAt = 0;
}

/** 基线检查（带全局节流）；返回本次是否真的做了采样 */
function checkRssBaseline(now: number): boolean {
  if (
    lastRssBaselineCheckAt !== 0 &&
    now - lastRssBaselineCheckAt < RSS_BASELINE_CHECK_MIN_INTERVAL
  ) {
    return false;
  }
  lastRssBaselineCheckAt = now;

  const cur = sample();
  const verdict = evaluateRssBaseline(rssBaselineState, cur.rssMb, now);
  rssBaselineState = verdict.next;
  if (verdict.action === 'adopted') {
    logger.info('memProfile:rss_baseline_adopted — 采纳启动稳态 RSS 为基线', {
      baselineMb: cur.rssMb,
      graceMs: RSS_BASELINE_THRESHOLDS.graceMs,
    });
  } else if (verdict.action === 'alert') {
    logger.warn('memProfile:rss_above_baseline — RSS 显著高于启动基线', {
      currentMb: cur.rssMb,
      baselineMb: rssBaselineState.baselineMb,
      ratio: +(verdict.ratio ?? 0).toFixed(2),
      deltaMb: +(verdict.deltaMb ?? 0).toFixed(1),
    });
  }
  return true;
}

/** 限流判定结果 */
export interface MemProfileEmitDecision {
  /** 本次是否应该落日志 */
  emit: boolean;
  /** 距上次放行期间被抑制的条数（放行时带出；未放行时为 0） */
  suppressed: number;
}

/**
 * 采样点限流判定（纯函数，P2-1）：
 * - 窗口内 ⇒ 累计 `suppressed` 并返回 `{emit:false}`；
 * - 窗口外 ⇒ 放行并带出累计数、重置窗口。
 *
 * 抽成纯函数以便直接单测（`memProfile` 本身受 env/内存水位门控，不易在测试里打开）。
 */
export function decideMemProfileEmit(
  store: Map<string, { at: number; suppressed: number }>,
  point: string,
  now: number,
  intervalMs: number = MEM_PROFILE_POINT_MIN_INTERVAL
): MemProfileEmitDecision {
  const state = store.get(point);
  if (state && now - state.at < intervalMs) {
    state.suppressed++;
    return { emit: false, suppressed: 0 };
  }
  const suppressed = state?.suppressed ?? 0;
  store.set(point, { at: now, suppressed: 0 });
  return { emit: true, suppressed };
}

interface MemSample {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
}

let last: MemSample | null = null;

function sample(): MemSample {
  const m = process.memoryUsage();
  return {
    rssMb: +(m.rss / 1048576).toFixed(1),
    heapUsedMb: +(m.heapUsed / 1048576).toFixed(1),
    heapTotalMb: +(m.heapTotal / 1048576).toFixed(1),
    externalMb: +(m.external / 1048576).toFixed(1),
  };
}

/**
 * 在关键点打一个内存采样日志（相对上一次采样的增量 + 绝对量）。
 *
 * P2-1（2026-11-04）：
 * - **按点限流**（{@link MEM_PROFILE_POINT_MIN_INTERVAL}），窗口内重复采样只计数；
 * - 仅由**内存水位**触发（未显式 `MEM_PROFILE=1`）时降为 `debug` —— 压力期仍可取证，
 *   但不把 info 面刷满；显式诊断模式保持 info。
 *
 * @param point 采样点标识（如 'context-build:post-map'）
 * @param extra 附加上下文（会话/消息数/内容长度等，可选）
 */
export function memProfile(
  point: string,
  extra?: Record<string, unknown>
): void {
  const now = Date.now();

  // A4（2026-11-05）：RSS 基线告警**不依赖 MEM_PROFILE** —— 否则诊断开关关着就永不告警。
  // 带 30s 全局节流，避免热点管线每轮都调 process.memoryUsage()。
  checkRssBaseline(now);

  if (!samplingActive()) return;

  // P2-1：按点限流（窗口内只累计，不落盘）
  const decision = decideMemProfileEmit(pointEmitState, point, now);
  if (!decision.emit) return;
  const suppressed = decision.suppressed;

  const cur = sample();

  const delta = last
    ? {
        dRssMb: +(cur.rssMb - last.rssMb).toFixed(1),
        dHeapUsedMb: +(cur.heapUsedMb - last.heapUsedMb).toFixed(1),
      }
    : { dRssMb: 0, dHeapUsedMb: 0 };
  last = cur;
  const payload = {
    rssMb: cur.rssMb,
    heapUsedMb: cur.heapUsedMb,
    heapTotalMb: cur.heapTotalMb,
    externalMb: cur.externalMb,
    ...delta,
    ...(suppressed > 0 ? { suppressed } : {}),
    ...extra,
  };
  // 显式诊断 ⇒ info；仅水位触发 ⇒ debug（P2-1 降噪）
  if (MEM_PROFILE_ENABLED) logger.info(`memProfile:${point}`, payload);
  else logger.debug(`memProfile:${point}`, payload);
}

/** 清空限流状态（测试隔离用；生产不调用） */
export function resetMemProfileThrottleForTest(): void {
  pointEmitState.clear();
  last = null;
  // A4：连同 RSS 基线状态一并复位，避免跨用例污染
  resetRssBaselineForTest();
}
