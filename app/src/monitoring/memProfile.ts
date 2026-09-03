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
import { Logger } from '@modules/monitoring/logs/Logger.js';
import { LogLevel } from '@modules/monitoring';
import { getMemoryPressureMonitor } from './memoryPressure/MemoryPressureMonitor.js';

const ENABLED = process.env.MEM_PROFILE === '1';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'chat:mem-profile',
});

/**
 * 采样激活：MEM_PROFILE=1（诊断跑批）**或**内存水位 ≥L0（2026-09-02 复查执行
 * §3.1/§3.4：压力期自动升级为逐点采样，无需重启带 MEM_PROFILE）。
 */
function samplingActive(): boolean {
  return ENABLED || getMemoryPressureMonitor().currentLevel() >= 1;
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
 * @param point 采样点标识（如 'context-build:post-map'）
 * @param extra 附加上下文（会话/消息数/内容长度等，可选）
 */
export function memProfile(
  point: string,
  extra?: Record<string, unknown>
): void {
  if (!samplingActive()) return;
  const cur = sample();
  const delta = last
    ? {
        dRssMb: +(cur.rssMb - last.rssMb).toFixed(1),
        dHeapUsedMb: +(cur.heapUsedMb - last.heapUsedMb).toFixed(1),
      }
    : { dRssMb: 0, dHeapUsedMb: 0 };
  last = cur;
  logger.info(`memProfile:${point}`, {
    rssMb: cur.rssMb,
    heapUsedMb: cur.heapUsedMb,
    heapTotalMb: cur.heapTotalMb,
    externalMb: cur.externalMb,
    ...delta,
    ...extra,
  });
}
