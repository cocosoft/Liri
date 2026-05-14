/**
 * Sprint 性能红线检查
 * 对标平安科技：每次 release 前跑性能回归，设定各阶段耗时红线
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * 性能阶段
 */
export type PerformancePhase =
  | 'startup'
  | 'module_init'
  | 'plugin_load'
  | 'first_response'
  | 'tool_execution';

/**
 * 性能红线
 */
export interface PerformanceRedline {
  phase: PerformancePhase;
  maxMs: number;
  warnMs: number;
  description: string;
}

/**
 * 性能检查结果
 */
export interface PerformanceCheckResult {
  phase: PerformancePhase;
  actualMs: number;
  redlineMs: number;
  passed: boolean;
  warned: boolean;
  message: string;
}

/**
 * SLO 报告
 */
export interface SLORreport {
  checkedAt: number;
  version: string;
  results: PerformanceCheckResult[];
  overallPassed: boolean;
  summary: string;
}

/**
 * 默认性能红线
 * 对标平安科技 StartupProfiler 各阶段耗时要求
 */
export const DEFAULT_REDLINES: PerformanceRedline[] = [
  {
    phase: 'startup',
    maxMs: 3000,
    warnMs: 2000,
    description: '系统启动阶段（加载配置、解析命令行、初始化核心模块）',
  },
  {
    phase: 'module_init',
    maxMs: 5000,
    warnMs: 3500,
    description: '模块初始化阶段（加载技能、工具、插件依赖图）',
  },
  {
    phase: 'plugin_load',
    maxMs: 3000,
    warnMs: 2000,
    description: '插件加载阶段（加载和初始化全部插件）',
  },
  {
    phase: 'first_response',
    maxMs: 2000,
    warnMs: 1500,
    description: '首响应阶段（收到第一条消息到返回首条响应）',
  },
  {
    phase: 'tool_execution',
    maxMs: 5000,
    warnMs: 3000,
    description: '工具执行阶段（单次工具调用的最大耗时）',
  },
];

/**
 * Sprint 性能红线检查器
 */
export class SprintPerformanceChecker {
  private redlines: Map<PerformancePhase, PerformanceRedline> = new Map();
  private results: PerformanceCheckResult[] = [];
  private version: string;

  /**
   * 构造函数
   * @param version 当前版本号
   * @param redlines 性能红线
   */
  constructor(version: string = '0.0.0', redlines?: PerformanceRedline[]) {
    this.version = version;
    const lines = redlines || DEFAULT_REDLINES;

    for (const line of lines) {
      this.redlines.set(line.phase, line);
    }
  }

  /**
   * 记录阶段耗时
   * @param phase 阶段
   * @param actualMs 实际耗时（毫秒）
   */
  record(phase: PerformancePhase, actualMs: number): PerformanceCheckResult {
    const redline = this.redlines.get(phase);
    if (!redline) {
      const result: PerformanceCheckResult = {
        phase,
        actualMs,
        redlineMs: 0,
        passed: true,
        warned: false,
        message: `阶段 "${phase}" 无红线定义，耗时 ${actualMs}ms`,
      };
      this.results.push(result);

      return result;
    }

    const passed = actualMs <= redline.maxMs;
    const warned = actualMs > redline.warnMs && actualMs <= redline.maxMs;

    const result: PerformanceCheckResult = {
      phase,
      actualMs,
      redlineMs: redline.maxMs,
      passed,
      warned,
      message: passed
        ? `阶段 "${phase}" 通过: ${actualMs}ms / ${redline.maxMs}ms`
        : `阶段 "${phase}" 超标: ${actualMs}ms / ${redline.maxMs}ms (超出 ${actualMs - redline.maxMs}ms)`,
    };

    this.results.push(result);

    return result;
  }

  /**
   * 生成 SLO 报告
   * @returns SLO 报告
   */
  generateSLOReport(): SLORreport {
    const overallPassed = this.results.every((r) => r.passed);
    const failedCount = this.results.filter((r) => !r.passed).length;
    const warnCount = this.results.filter((r) => r.warned).length;

    let summary = overallPassed
      ? '✅ 所有阶段通过性能红线检查'
      : `❌ ${failedCount} 个阶段超出性能红线`;

    if (warnCount > 0 && overallPassed) {
      summary += ` (${warnCount} 个阶段进入警告区)`;
    }

    return {
      checkedAt: Date.now(),
      version: this.version,
      results: [...this.results],
      overallPassed,
      summary,
    };
  }

  /**
   * 格式化 SLO 报告为文本
   * @returns 格式化的文本
   */
  formatSLOReport(): string {
    const report = this.generateSLOReport();
    const lines: string[] = [];

    lines.push('=== Sprint 性能红线检查报告 ===');
    lines.push(`版本: ${report.version}`);
    lines.push(`检查时间: ${new Date(report.checkedAt).toISOString()}`);
    lines.push(`状态: ${report.summary}`);
    lines.push('');

    lines.push('阶段\t实际\t红线\t状态');
    for (const result of report.results) {
      const status = result.passed ? (result.warned ? '⚠️' : '✅') : '❌';
      lines.push(
        `${result.phase}\t${result.actualMs}ms\t${result.redlineMs}ms\t${status}`
      );
    }

    if (!report.overallPassed) {
      lines.push('');
      lines.push('⚠️ 存在超标项，请在 release 前修复！');
    }

    return lines.join('\n');
  }

  /**
   * 导出 SLO 报告为 JSON
   * @returns JSON 字符串
   */
  exportJSON(): string {
    return JSON.stringify(this.generateSLOReport(), null, 2);
  }

  /**
   * 保存 SLO 报告到文件
   * @param dir 目录
   * @returns 文件路径
   */
  saveReport(dir: string): string {
    const report = this.generateSLOReport();
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filePath = path.join(dir, `slo-report-${dateStr}.json`);

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));

    return filePath;
  }

  /**
   * 清除结果
   */
  clear(): void {
    this.results = [];
  }

  /**
   * 是否全部通过
   */
  isAllPassed(): boolean {
    return this.results.every((r) => r.passed);
  }

  /**
   * 获取超标项
   */
  getFailures(): PerformanceCheckResult[] {
    return this.results.filter((r) => !r.passed);
  }

  /**
   * 获取警告项
   */
  getWarnings(): PerformanceCheckResult[] {
    return this.results.filter((r) => r.warned);
  }
}

/**
 * 使用时间差记录的可执行性能测试
 * @param checker 检查器
 * @param phase 阶段
 * @param fn 要执行的函数
 * @returns 函数返回值
 */
export async function withPerformanceCheck<T>(
  checker: SprintPerformanceChecker,
  phase: PerformancePhase,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();

  try {
    const result = await fn();

    checker.record(phase, Date.now() - startTime);

    return result;
  } catch (err) {
    checker.record(phase, Date.now() - startTime);

    throw err;
  }
}
