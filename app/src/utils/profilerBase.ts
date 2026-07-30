/**
 * 基础性能分析工具函数
 */

/**
 * 获取性能对象
 */
export function getPerformance(): Performance {
  return (
    performance ||
    (globalThis as unknown as { performance?: Performance }).performance ||
    require('perf_hooks').performance
  );
}

/**
 * 格式化毫秒数
 */
export function formatMs(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)}μs`;
  }
  if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * 格式化内存使用情况
 */
function formatMemory(memory: NodeJS.MemoryUsage | undefined): string {
  if (!memory) return 'N/A';
  const rss = (memory.rss / 1024 / 1024).toFixed(1);
  const heapUsed = (memory.heapUsed / 1024 / 1024).toFixed(1);
  const heapTotal = (memory.heapTotal / 1024 / 1024).toFixed(1);
  return `RSS: ${rss}MB, Heap: ${heapUsed}/${heapTotal}MB`;
}

/**
 * 格式化时间线行
 */
export function formatTimelineLine(
  timestamp: number,
  delta: number,
  name: string,
  memory?: NodeJS.MemoryUsage,
  timeWidth: number = 10,
  deltaWidth: number = 10,
  warning: string = ''
): string {
  const timeStr = formatMs(timestamp).padStart(timeWidth);
  const deltaStr = formatMs(delta).padStart(deltaWidth);
  const memoryStr = memory ? formatMemory(memory) : '';
  return `${timeStr} | ${deltaStr} | ${name}${warning} ${memoryStr ? `| ${memoryStr}` : ''}`;
}
