/**
 * 启动链路集成（兼容层）
 *
 * 将阶段计时委托给 performance/StartupProfiler。
 * 保留 SprintPerformanceChecker 的 SLO 红线检查功能。
 */
import {
  SprintPerformanceChecker,
  type PerformancePhase,
} from '../core/performance/SprintPerformanceChecker';
import { DEFAULT_REDLINES } from '../core/performance/SprintPerformanceChecker';
import {
  profilePhaseStart,
  profilePhaseEnd,
} from '../performance/StartupProfiler.js';

export interface StartupPhase {
  name: PerformancePhase;
  label: string;
  order: number;
}

/** 启动阶段列表 */
export const STARTUP_PHASES: StartupPhase[] = [
  { name: 'startup', label: '系统启动', order: 1 },
  { name: 'startup_config', label: 'startup.yaml 加载', order: 2 },
  { name: 'env_init', label: '环境初始化', order: 3 },
  { name: 'config_load', label: '配置加载', order: 4 },
  { name: 'module_init', label: '模块初始化', order: 5 },
  { name: 'tool_init', label: '工具系统初始化', order: 6 },
  { name: 'extensibility_init', label: '扩展性服务初始化', order: 7 },
  { name: 'command_init', label: '命令系统初始化', order: 8 },
  { name: 'monitoring_init', label: '监控服务初始化', order: 9 },
  { name: 'provider_init', label: 'AI Provider 注册', order: 10 },
  { name: 'gateway_init', label: 'Gateway 通道初始化', order: 11 },
  { name: 'plugin_load', label: '插件加载', order: 12 },
  { name: 'plugin_start_all', label: '插件启动', order: 13 },
  { name: 'session_init', label: '会话初始化', order: 14 },
  { name: 'context_init', label: '上下文初始化', order: 15 },
  { name: 'memory_init', label: '记忆系统初始化', order: 16 },
  { name: 'skill_load', label: '技能加载', order: 17 },
  { name: 'sandbox_init', label: '沙箱初始化', order: 18 },
  { name: 'deferred_prefetch_start', label: '延迟预加载启动', order: 19 },
  { name: 'app_ready', label: '应用就绪', order: 20 },
  { name: 'first_response', label: '首响应就绪', order: 21 },
  { name: 'tool_execution', label: '工具就绪', order: 22 },
  { name: 'tool_discovery', label: '工具发现', order: 23 },
  { name: 'tool_invoke', label: '工具调用', order: 24 },
];

/**
 * 启动链路管理器（兼容层）
 *
 * 阶段计时委托给 performance/StartupProfiler。
 * 保留 SLO 红线检查功能。
 */
export class StartupChainProfiler {
  private checker: SprintPerformanceChecker;
  private version: string;

  constructor(version: string = '0.0.0') {
    this.version = version;
    this.checker = new SprintPerformanceChecker(version, DEFAULT_REDLINES);
  }

  /**
   * 标记阶段开始（委托给 StartupProfiler）
   */
  markPhaseStart(phase: PerformancePhase): void {
    profilePhaseStart(phase);
  }

  /**
   * 标记阶段结束并记录耗时（委托给 StartupProfiler）
   */
  markPhaseEnd(phase: PerformancePhase): number {
    const elapsed = profilePhaseEnd(phase);
    this.checker.record(phase, elapsed);
    return elapsed;
  }

  /** 生成启动性能报告 */
  generateSLOReport(): string {
    return this.checker.formatSLOReport();
  }

  /** 检查是否全部通过红线 */
  isAllPassed(): boolean {
    return this.checker.isAllPassed();
  }

  /** 获取超标项 */
  getFailures() {
    return this.checker.getFailures();
  }

  /** 获取警告项 */
  getWarnings() {
    return this.checker.getWarnings();
  }

  /** 保存报告 */
  saveReport(dir: string): string {
    return this.checker.saveReport(dir);
  }

  /** 导出 JSON */
  exportJSON(): string {
    return this.checker.exportJSON();
  }

  /** 重置 */
  reset(): void {
    this.checker.clear();
  }

  /** 获取版本号 */
  getVersion(): string {
    return this.version;
  }
}

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
