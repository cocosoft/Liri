//
/**
 * 启动性能分析工具
 * 用于测量和报告应用启动过程中各个阶段的时间消耗
 *
 * 两种模式：
 * 1. 采样日志：100% 内部用户，0.1% 外部用户 - 记录阶段到分析系统
 * 2. 详细分析：Liri_PROFILE_STARTUP=1 - 完整报告，包括内存快照
 *
 * 使用 Node.js 内置的性能钩子 API 进行标准时间测量
 */

import { dirname, join } from 'path';
import { logForDebugging } from '../utils/debug.js';
import { getConfigHomeDir, isEnvTruthy } from '../utils/envUtils.js';
import fs from 'fs';
import { getPerformanceConfig } from './PerformanceConfig.js';
import { configManager } from '@modules/config';

// 模块级状态 - 在模块加载时决定
const DETAILED_PROFILING = isEnvTruthy(
  configManager.env('Liri_PROFILE_STARTUP')
);

// 采样率：100% 内部用户，0.5% 外部用户
const STATSIG_SAMPLE_RATE = 0.005;
const STATSIG_LOGGING_SAMPLED =
  configManager.env('USER_TYPE') === 'ant' ||
  Math.random() < STATSIG_SAMPLE_RATE;

// 启动阶段定义
const PHASE_DEFINITIONS: Record<string, [string, string]> = {
  init_function: ['init_function_start', 'init_function_end'],
  config: ['config_init_start', 'config_init_complete'],
  analytics: ['analytics_init_start', 'analytics_init_complete'],
  auth: ['auth_init_start', 'auth_init_complete'],
  plugins: ['plugins_init_start', 'plugins_init_complete'],
  skills: ['skills_init_start', 'skills_init_complete'],
  monitoring: ['monitoring_init_start', 'monitoring_init_complete'],
  commands: ['commands_init_start', 'commands_init_complete'],
  startup: ['main_start', 'startup_complete'],
  app: ['app_start', 'app_running'],
};

// 内存快照
const memorySnapshots: NodeJS.MemoryUsage[] = [];

// 启动阶段时间
const phaseTimes: Record<string, number> = {};

/**
 * 格式化毫秒数为可读字符串
 */
function formatMs(ms: number): string {
  return ms.toFixed(1);
}

/**
 * 格式化时间线行
 */
function formatTimelineLine(
  timestamp: number,
  duration: number,
  name: string,
  memory?: NodeJS.MemoryUsage,
  timeWidth: number = 8,
  memWidth: number = 7
): string {
  const timeStr = formatMs(duration).padStart(timeWidth);
  let memStr = '';

  if (memory) {
    const heapUsedMB = Math.round((memory.heapUsed / 1024 / 1024) * 10) / 10;
    memStr = `${heapUsedMB}MB`.padStart(memWidth);
  }

  return `${timeStr}ms ${memStr} ${name}`;
}

/**
 * 获取性能 API 实例
 */
function getPerformance() {
  return performance;
}

/**
 * 记录启动阶段检查点
 * @param name 检查点名称
 */
export function profileCheckpoint(name: string): void {
  const perf = getPerformance();
  perf.mark(name);

  // 记录内存快照（仅在详细分析模式下）
  if (DETAILED_PROFILING) {
    memorySnapshots.push(process.memoryUsage());
  }
}

/**
 * 记录启动阶段开始
 * @param phase 阶段名称
 */
export function profilePhaseStart(phase: string): void {
  const perf = getPerformance();
  perf.mark(`${phase}_start`);

  // 记录内存快照（仅在详细分析模式下）
  if (DETAILED_PROFILING) {
    memorySnapshots.push(process.memoryUsage());
  }
}

/**
 * 记录启动阶段结束
 * @param phase 阶段名称
 */
export function profilePhaseEnd(phase: string): number {
  const perf = getPerformance();
  const endMark = `${phase}_end`;
  const startMark = `${phase}_start`;

  perf.mark(endMark);

  try {
    perf.measure(phase, startMark, endMark);
  } catch {
    // 起始标记不存在时（如未调用 profilePhaseStart），忽略测量
  }

  // 获取阶段时间
  const measures = perf.getEntriesByName(phase, 'measure');
  const duration =
    measures.length > 0 ? measures[measures.length - 1].duration : 0;
  phaseTimes[phase] = duration;

  // 记录内存快照（仅在详细分析模式下）
  if (DETAILED_PROFILING) {
    memorySnapshots.push(process.memoryUsage());
  }

  return duration;
}

/**
 * 测量异步函数执行时间
 * 对标 OpenClaw run-main.ts startupTrace.measure()：自动标记开始/结束并计算耗时
 *
 * @param name 测量名称
 * @param fn 要测量的异步函数
 * @returns 函数执行结果
 */
export async function profileMeasure<T>(
  name: string,
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const perf = getPerformance();
  const startMark = `measure_${name}_start`;
  const endMark = `measure_${name}_end`;

  perf.mark(startMark);
  const startTime = performance.now();

  try {
    const result = await fn();

    perf.mark(endMark);
    perf.measure(name, startMark, endMark);

    const duration = performance.now() - startTime;
    phaseTimes[name] = duration;

    if (DETAILED_PROFILING) {
      memorySnapshots.push(process.memoryUsage());
    }

    return { result, duration };
  } catch (error) {
    perf.mark(endMark);
    perf.measure(name, startMark, endMark);

    const duration = performance.now() - startTime;
    phaseTimes[name] = duration;

    throw error;
  }
}

/**
 * 生成启动性能报告
 * 仅在 DETAILED_PROFILING 启用时可用
 */
export function profileReport(): string {
  if (!DETAILED_PROFILING) {
    return '启动性能分析未启用';
  }

  const perf = getPerformance();
  const marks = perf.getEntriesByType('mark');
  const measures = perf.getEntriesByType('measure');

  if (marks.length === 0 && measures.length === 0) {
    return '未记录任何检查点或阶段';
  }

  const lines: string[] = [];
  lines.push('='.repeat(80));
  lines.push('启动性能分析报告');
  lines.push('='.repeat(80));
  lines.push('');

  // 输出检查点时间线
  lines.push('检查点时间线:');
  let prevTime = 0;
  for (const [i, mark] of marks.entries()) {
    lines.push(
      formatTimelineLine(
        mark.startTime,
        mark.startTime - prevTime,
        mark.name,
        memorySnapshots[i],
        8,
        7
      )
    );
    prevTime = mark.startTime;
  }
  lines.push('');

  // 输出阶段时间
  if (measures.length > 0) {
    lines.push('阶段时间:');
    for (const measure of measures) {
      lines.push(
        formatTimelineLine(measure.startTime, measure.duration, measure.name)
      );
    }
    lines.push('');
  }

  // 输出自定义阶段时间
  if (Object.keys(phaseTimes).length > 0) {
    lines.push('自定义阶段时间:');
    for (const [phase, duration] of Object.entries(phaseTimes)) {
      lines.push(formatTimelineLine(0, duration, phase));
    }
    lines.push('');
  }

  // 输出总启动时间
  const lastMark = marks[marks.length - 1];
  const totalTime = lastMark?.startTime ?? 0;
  lines.push(`总启动时间: ${formatMs(totalTime)}ms`);

  // 输出内存使用情况
  if (memorySnapshots.length > 0) {
    const firstMemory = memorySnapshots[0];
    const lastMemory = memorySnapshots[memorySnapshots.length - 1];
    lines.push('');
    lines.push('内存使用变化:');
    lines.push(
      `  开始: ${Math.round((firstMemory.heapUsed / 1024 / 1024) * 10) / 10}MB`
    );
    lines.push(
      `  结束: ${Math.round((lastMemory.heapUsed / 1024 / 1024) * 10) / 10}MB`
    );
    lines.push(
      `  增长: ${Math.round(((lastMemory.heapUsed - firstMemory.heapUsed) / 1024 / 1024) * 10) / 10}MB`
    );
  }

  lines.push('='.repeat(80));

  const report = lines.join('\n');

  // 记录到调试日志
  logForDebugging(report);

  // 写入文件（仅在详细分析模式下）
  if (DETAILED_PROFILING) {
    try {
      const logPath = getStartupPerfLogPath();
      const logDir = dirname(logPath);

      // 确保目录存在
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      fs.writeFileSync(logPath, report);
      logForDebugging(`启动性能报告已写入: ${logPath}`);
    } catch (error) {
      logForDebugging(
        `写入启动性能报告失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return report;
}

/**
 * 检查是否启用了详细分析
 */
export function isDetailedProfilingEnabled(): boolean {
  return DETAILED_PROFILING;
}

/**
 * 获取启动性能日志路径
 */
export function getStartupPerfLogPath(): string {
  const sessionId = Date.now().toString();
  return join(getConfigHomeDir(), 'startup-perf', `${sessionId}.txt`);
}

/**
 * 获取启动阶段时间
 */
export function getPhaseTimes(): Record<string, number> {
  return { ...phaseTimes };
}

/**
 * 阶段摘要条目（替代 StartupTracer.TraceReport.phaseSummary）
 */
export interface PhaseSummaryEntry {
  phase: string;
  duration: number;
  ratio: number;
}

/**
 * 获取指定阶段的耗时（毫秒）
 * @param phase 阶段名称
 * @returns 阶段耗时，未找到则返回 -1
 */
export function getPhaseDuration(phase: string): number {
  return phaseTimes[phase] ?? -1;
}

/**
 * 获取启动阶段摘要
 * 按耗时降序排列，包含每个阶段耗时及其占总时长比例
 * 无需 DETAILED_PROFILING 环境变量即可工作
 */
export function getPhaseSummary(): {
  totalDuration: number;
  phaseSummary: PhaseSummaryEntry[];
} {
  const times = getPhaseTimes();
  const entries = Object.entries(times).filter(([, d]) => d > 0);
  const totalDuration = entries.reduce((max, [, d]) => Math.max(max, d), 0);

  const phaseSummary = entries
    .map(([phase, duration]) => ({
      phase,
      duration,
      ratio: totalDuration > 0 ? duration / totalDuration : 0,
    }))
    .sort((a, b) => b.duration - a.duration);

  return { totalDuration, phaseSummary };
}

/**
 * 记录启动性能阶段到分析系统
 * 仅在会话被采样时记录
 */
export function logStartupPerf(): void {
  // 仅在被采样时记录（在模块加载时决定）
  if (!STATSIG_LOGGING_SAMPLED) return;

  const perf = getPerformance();
  const marks = perf.getEntriesByType('mark');
  const measures = perf.getEntriesByType('measure');

  if (marks.length === 0 && measures.length === 0) return;

  // 构建检查点查找表
  const checkpointTimes = new Map<string, number>();
  for (const mark of marks) {
    checkpointTimes.set(mark.name, mark.startTime);
  }

  // 计算阶段持续时间
  const metadata: Record<string, number | undefined> = {};

  // 计算预定义阶段时间
  for (const [phaseName, [startCheckpoint, endCheckpoint]] of Object.entries(
    PHASE_DEFINITIONS
  )) {
    const startTime = checkpointTimes.get(startCheckpoint);
    const endTime = checkpointTimes.get(endCheckpoint);

    if (startTime !== undefined && endTime !== undefined) {
      metadata[`${phaseName}_ms`] = Math.round(endTime - startTime);
    }
  }

  // 计算自定义阶段时间
  for (const [phase, duration] of Object.entries(phaseTimes)) {
    metadata[`${phase}_ms`] = Math.round(duration);
  }

  // 添加检查点和阶段数量用于调试
  metadata.checkpoint_count = marks.length;
  metadata.phase_count = measures.length + Object.keys(phaseTimes).length;

  // 记录到调试日志
  logForDebugging('启动性能数据:', metadata);
}
