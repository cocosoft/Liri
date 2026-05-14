/**
 * 启动链路集成
 * 对标平安科技：将 StartupProfiler 接入 SprintPerformanceChecker
 * 在构建系统时自动记录各阶段耗时，release 前检查性能红线
 */
import {
  SprintPerformanceChecker,
  type PerformancePhase,
} from '../core/performance/SprintPerformanceChecker';
import { DEFAULT_REDLINES } from '../core/performance/SprintPerformanceChecker';

/**
 * 启动阶段定义
 */
export interface StartupPhase {
  name: PerformancePhase;
  label: string;
  order: number;
}

/**
 * 启动阶段列表
 */
export const STARTUP_PHASES: StartupPhase[] = [
  { name: 'startup', label: '系统启动', order: 1 },
  { name: 'module_init', label: '模块初始化', order: 2 },
  { name: 'plugin_load', label: '插件加载', order: 3 },
  { name: 'first_response', label: '首响应就绪', order: 4 },
  { name: 'tool_execution', label: '工具就绪', order: 5 },
];

/**
 * 启动链路管理器
 */
export class StartupChainProfiler {
  private checker: SprintPerformanceChecker;
  private phaseTimers: Map<PerformancePhase, number> = new Map();
  private version: string;

  /**
   * 构造函数
   * @param version 版本号
   */
  constructor(version: string = '0.0.0') {
    this.version = version;
    this.checker = new SprintPerformanceChecker(version, DEFAULT_REDLINES);
  }

  /**
   * 标记阶段开始
   * @param phase 阶段
   */
  markPhaseStart(phase: PerformancePhase): void {
    this.phaseTimers.set(phase, Date.now());
  }

  /**
   * 标记阶段结束并记录耗时
   * @param phase 阶段
   * @returns 耗时（毫秒）
   */
  markPhaseEnd(phase: PerformancePhase): number {
    const startTime = this.phaseTimers.get(phase);
    if (!startTime) return 0;

    const elapsed = Date.now() - startTime;
    this.phaseTimers.delete(phase);
    this.checker.record(phase, elapsed);

    return elapsed;
  }

  /**
   * 获取所有阶段的耗时记录
   * @returns 阶段耗时映射
   */
  getPhaseDurations(): Map<PerformancePhase, number> {
    const durations = new Map<PerformancePhase, number>();

    for (const phase of STARTUP_PHASES) {
      const startTime = this.phaseTimers.get(phase.name);
      if (startTime) {
        durations.set(phase.name, Date.now() - startTime);
      }
    }

    return durations;
  }

  /**
   * 生成启动性能报告
   * @returns SLO 报告文本
   */
  generateSLOReport(): string {
    return this.checker.formatSLOReport();
  }

  /**
   * 检查是否全部通过红线
   */
  isAllPassed(): boolean {
    return this.checker.isAllPassed();
  }

  /**
   * 获取超标项
   */
  getFailures() {
    return this.checker.getFailures();
  }

  /**
   * 获取警告项
   */
  getWarnings() {
    return this.checker.getWarnings();
  }

  /**
   * 保存报告
   * @param dir 目录
   */
  saveReport(dir: string): string {
    return this.checker.saveReport(dir);
  }

  /**
   * 导出 JSON
   */
  exportJSON(): string {
    return this.checker.exportJSON();
  }

  /**
   * 重置
   */
  reset(): void {
    this.phaseTimers.clear();
    this.checker.clear();
  }

  /**
   * 获取版本号
   */
  getVersion(): string {
    return this.version;
  }
}

/**
 * 全局启动链路分析器
 */
let globalProfiler: StartupChainProfiler | null = null;

/**
 * 获取全局启动链路分析器
 */
export function getStartupChainProfiler(): StartupChainProfiler {
  if (!globalProfiler) {
    const version =
      process.env['PY_APP_SLO_VERSION'] ||
      process.env['npm_package_version'] ||
      '0.0.0';

    globalProfiler = new StartupChainProfiler(version);
  }

  return globalProfiler;
}

/**
 * 重置全局启动链路分析器
 */
export function resetStartupChainProfiler(): void {
  globalProfiler = null;
}
