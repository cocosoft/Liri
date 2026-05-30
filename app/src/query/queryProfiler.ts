/**
 * 查询性能分析器
 * 参考CC源码 cc_code/backend/utils/queryProfiler.ts 实现
 * 提供查询性能分析和检查点记录功能
 */

const ENABLED =
  typeof process !== 'undefined' && process.env?.Liri_PROFILE_QUERY === '1';

const checkpoints: Array<{ name: string; time: number }> = [];
let queryCount = 0;

/**
 * 开始查询性能分析
 */
export function startQueryProfile(): void {
  if (!ENABLED) return;
  checkpoints.length = 0;
  queryCount++;
  checkpoints.push({ name: 'query_start', time: performance.now() });
}

/**
 * 记录检查点
 * @param name 检查点名称
 */
export function queryCheckpoint(name: string): void {
  if (!ENABLED) return;
  checkpoints.push({ name, time: performance.now() });
}

/**
 * 结束查询性能分析
 */
export function endQueryProfile(): void {
  if (!ENABLED) return;
  checkpoints.push({ name: 'query_end', time: performance.now() });
  printProfileReport();
}

/**
 * 打印性能分析报告
 */
function printProfileReport(): void {
  if (checkpoints.length < 2) return;

  const baseline = checkpoints[0].time;
  const lines: string[] = [];
  lines.push('='.repeat(60));
  lines.push(`QUERY PROFILING REPORT - Query #${queryCount}`);
  lines.push('='.repeat(60));

  let prevTime = baseline;
  for (let i = 1; i < checkpoints.length; i++) {
    const cp = checkpoints[i];
    const relativeTime = cp.time - baseline;
    const deltaMs = cp.time - prevTime;
    const warning =
      deltaMs > 1000 ? ' ⚠️ VERY SLOW' : deltaMs > 100 ? ' ⚠️ SLOW' : '';
    lines.push(
      `  [+${relativeTime.toFixed(0)}ms] ${cp.name} (Δ${deltaMs.toFixed(0)}ms)${warning}`
    );
    prevTime = cp.time;
  }

  const totalTime = checkpoints[checkpoints.length - 1].time - baseline;
  lines.push('-'.repeat(60));
  lines.push(`Total: ${totalTime.toFixed(0)}ms`);
  lines.push('');

  console.log(lines.join('\n'));
}

/**
 * 格式化毫秒数
 * @param ms 毫秒数
 * @returns 格式化后的字符串
 */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
