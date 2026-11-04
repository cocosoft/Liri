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
  if (!samplingActive()) return;

  // P2-1：按点限流（窗口内只累计，不落盘）
  const decision = decideMemProfileEmit(pointEmitState, point, Date.now());
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
}
