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
 * 启动阶段列表（对标 CC 61+ checkpoint）
 * 按启动流程分为 7 组共 23 个阶段
 */
export const STARTUP_PHASES: StartupPhase[] = [
  // Group 1: 核心启动（Core Boot）
  { name: 'startup', label: '系统启动', order: 1 },
  { name: 'startup_config', label: 'startup.yaml 加载', order: 2 },
  { name: 'env_init', label: '环境初始化', order: 3 },
  { name: 'config_load', label: '配置加载', order: 4 },

  // Group 2: 模块初始化（Module Init）
  { name: 'module_init', label: '模块初始化', order: 5 },
  { name: 'tool_init', label: '工具系统初始化', order: 6 },
  { name: 'extensibility_init', label: '扩展性服务初始化', order: 7 },
  { name: 'command_init', label: '命令系统初始化', order: 8 },
  { name: 'monitoring_init', label: '监控服务初始化', order: 9 },
  { name: 'provider_init', label: 'AI Provider 注册', order: 10 },
  { name: 'gateway_init', label: 'Gateway 通道初始化', order: 11 },

  // Group 3: 插件加载（Plugin Load）
  { name: 'plugin_load', label: '插件加载', order: 12 },
  { name: 'plugin_start_all', label: '插件启动', order: 13 },

  // Group 4: 运行环境（Runtime）
  { name: 'session_init', label: '会话初始化', order: 14 },
  { name: 'context_init', label: '上下文初始化', order: 15 },
  { name: 'memory_init', label: '记忆系统初始化', order: 16 },
  { name: 'skill_load', label: '技能加载', order: 17 },
  { name: 'sandbox_init', label: '沙箱初始化', order: 18 },

  // Group 5: 延迟加载（Deferred）
  { name: 'deferred_prefetch_start', label: '延迟预加载启动', order: 19 },

  // Group 6: 就绪（Ready）
  { name: 'app_ready', label: '应用就绪', order: 20 },

  // Group 7: 运行时（Runtime）
  { name: 'first_response', label: '首响应就绪', order: 21 },
  { name: 'tool_execution', label: '工具就绪', order: 22 },
  { name: 'tool_discovery', label: '工具发现', order: 23 },
  { name: 'tool_invoke', label: '工具调用', order: 24 },
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
