/**
 * 启动报告服务
 * 用于生成详细的应用启动性能报告
 */

import path from 'path';
import fs from 'fs';
import { resolveDataSubDir, resolveProjectRoot } from '@modules/core';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = getLogger('performance:StartupReportService');

/**
 * 启动报告配置
 */
export interface StartupReportConfig {
  enabled: boolean;
  reportPath: string;
  includeMemory: boolean;
  includeTimings: boolean;
  includeEnvironment: boolean;
  includeDependencies: boolean;
  includeCheckpoints: boolean;
  exportJson: boolean;
  exportMarkdown: boolean;
}

/**
 * 启动检查点
 */
export interface StartupCheckpoint {
  name: string;
  timestamp: number;
  duration: number;
  details?: Record<string, unknown>;
}

/**
 * 启动报告数据
 */
export interface StartupReport {
  id: string;
  startTime: number;
  endTime: number;
  totalDuration: number;
  memory: {
    initial: NodeJS.MemoryUsage;
    final: NodeJS.MemoryUsage;
  };
  checkpoints: StartupCheckpoint[];
  environment: Record<string, string>;
  dependencies: Record<string, string>;
  system: {
    platform: string;
    arch: string;
    version: string;
  };
}

/**
 * 启动报告服务
 */
export class StartupReportService {
  private static instance: StartupReportService;
  private config: StartupReportConfig;
  private checkpoints: StartupCheckpoint[] = [];
  private startTime: number;
  private endTime: number | null = null;
  private initialMemory: NodeJS.MemoryUsage | null = null;
  private finalMemory: NodeJS.MemoryUsage | null = null;

  private constructor() {
    this.config = {
      enabled: true,
      reportPath: resolveDataSubDir('reports'),
      includeMemory: true,
      includeTimings: true,
      includeEnvironment: true,
      includeDependencies: true,
      includeCheckpoints: true,
      exportJson: true,
      exportMarkdown: true,
    };
    this.startTime = Date.now();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): StartupReportService {
    if (!StartupReportService.instance) {
      StartupReportService.instance = new StartupReportService();
    }
    return StartupReportService.instance;
  }

  /**
   * 开始启动计时
   */
  public start(): void {
    this.startTime = Date.now();
    this.checkpoints = [];
    this.endTime = null;

    if (this.config.includeMemory) {
      this.initialMemory = process.memoryUsage();
    }
  }

  /**
   * 结束启动计时
   */
  public end(): void {
    this.endTime = Date.now();

    if (this.config.includeMemory) {
      this.finalMemory = process.memoryUsage();
    }
  }

  /**
   * 添加检查点
   */
  public checkpoint(name: string, details?: Record<string, unknown>): void {
    const now = Date.now();
    const duration = now - this.startTime;

    this.checkpoints.push({
      name,
      timestamp: now,
      duration,
      details,
    });
  }

  /**
   * 生成启动报告
   */
  public generateReport(): StartupReport {
    const report: StartupReport = {
      id: `startup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      startTime: this.startTime,
      endTime: this.endTime || Date.now(),
      totalDuration: (this.endTime || Date.now()) - this.startTime,
      memory: {
        initial: this.initialMemory || process.memoryUsage(),
        final: this.finalMemory || process.memoryUsage(),
      },
      checkpoints: [...this.checkpoints],
      environment: this.getEnvironmentInfo(),
      dependencies: this.getDependencies(),
      system: {
        platform: process.platform,
        arch: process.arch,
        version: process.version,
      },
    };

    this.saveReport(report);
    return report;
  }

  /**
   * 保存报告
   */
  private saveReport(report: StartupReport): void {
    if (!this.config.enabled) {
      return;
    }

    try {
      if (!fs.existsSync(this.config.reportPath)) {
        fs.mkdirSync(this.config.reportPath, { recursive: true });
      }

      if (this.config.exportJson) {
        const jsonPath = path.join(this.config.reportPath, `${report.id}.json`);
        const reportData = {
          ...report,
          startTime: new Date(report.startTime).toISOString(),
          endTime: new Date(report.endTime).toISOString(),
          checkpoints: report.checkpoints.map((cp) => ({
            ...cp,
            timestamp: new Date(cp.timestamp).toISOString(),
          })),
        };

        fs.writeFileSync(jsonPath, JSON.stringify(reportData, null, 2));
      }

      if (this.config.exportMarkdown) {
        const mdPath = path.join(this.config.reportPath, `${report.id}.md`);
        const mdContent = this.generateMarkdownReport(report);
        fs.writeFileSync(mdPath, mdContent);
      }
    } catch (error) {
      // 忽略错误
    }
  }

  /**
   * 生成Markdown报告
   */
  private generateMarkdownReport(report: StartupReport): string {
    const lines: string[] = [];

    lines.push('# 启动性能报告');
    lines.push('');
    lines.push(`**报告ID**: ${report.id}`);
    lines.push(`**启动时间**: ${new Date(report.startTime).toISOString()}`);
    lines.push(`**结束时间**: ${new Date(report.endTime).toISOString()}`);
    lines.push(`**总持续时间**: ${report.totalDuration.toFixed(2)}ms`);
    lines.push('');

    if (this.config.includeMemory) {
      lines.push('## 内存使用');
      lines.push('');
      lines.push('| 指标 | 初始值 | 最终值 | 变化 |');
      lines.push('|------|--------|--------|------|');
      lines.push(
        `| 堆使用 | ${(report.memory.initial.heapUsed / 1024 / 1024).toFixed(2)}MB | ${(report.memory.final.heapUsed / 1024 / 1024).toFixed(2)}MB | ${((report.memory.final.heapUsed - report.memory.initial.heapUsed) / 1024 / 1024).toFixed(2)}MB |`
      );
      lines.push(
        `| 堆总量 | ${(report.memory.initial.heapTotal / 1024 / 1024).toFixed(2)}MB | ${(report.memory.final.heapTotal / 1024 / 1024).toFixed(2)}MB | ${((report.memory.final.heapTotal - report.memory.initial.heapTotal) / 1024 / 1024).toFixed(2)}MB |`
      );
      lines.push(
        `| RSS | ${(report.memory.initial.rss / 1024 / 1024).toFixed(2)}MB | ${(report.memory.final.rss / 1024 / 1024).toFixed(2)}MB | ${((report.memory.final.rss - report.memory.initial.rss) / 1024 / 1024).toFixed(2)}MB |`
      );
      lines.push('');
    }

    if (this.config.includeCheckpoints && report.checkpoints.length > 0) {
      lines.push('## 启动阶段');
      lines.push('');
      lines.push('| 阶段 | 时间点 | 耗时 |');
      lines.push('|------|--------|------|');
      report.checkpoints.forEach((cp, index) => {
        const previousDuration =
          index > 0 ? report.checkpoints[index - 1].duration : 0;
        const stageDuration = cp.duration - previousDuration;
        lines.push(
          `| ${cp.name} | ${new Date(cp.timestamp).toISOString()} | ${stageDuration.toFixed(2)}ms |`
        );
      });
      lines.push('');
    }

    if (this.config.includeEnvironment) {
      lines.push('## 环境信息');
      lines.push('');
      Object.entries(report.environment).forEach(([key, value]) => {
        lines.push(`- **${key}**: ${value}`);
      });
      lines.push('');
    }

    if (
      this.config.includeDependencies &&
      Object.keys(report.dependencies).length > 0
    ) {
      lines.push('## 依赖版本');
      lines.push('');
      Object.entries(report.dependencies).forEach(([name, version]) => {
        lines.push(`- **${name}**: ${version}`);
      });
      lines.push('');
    }

    lines.push('## 系统信息');
    lines.push('');
    lines.push(`- **平台**: ${report.system.platform}`);
    lines.push(`- **架构**: ${report.system.arch}`);
    lines.push(`- **Node.js版本**: ${report.system.version}`);

    return lines.join('\n');
  }

  /**
   * 获取环境信息
   */
  private getEnvironmentInfo(): Record<string, string> {
    const env: Record<string, string> = {};
    const importantEnvVars = [
      'NODE_ENV',
      'NODE_PATH',
      'Liri_SLOW_OPERATION_THRESHOLD_MS',
      'Liri_PERFETTO_TRACE',
      'PORT',
      'HOST',
    ];

    importantEnvVars.forEach((key) => {
      if (process.env[key]) {
        env[key] = process.env[key]!;
      }
    });

    return env;
  }

  /**
   * 获取依赖版本
   */
  private getDependencies(): Record<string, string> {
    const deps: Record<string, string> = {};

    try {
      const packageJsonPath = path.join(resolveProjectRoot(), 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, 'utf8')
        );

        if (packageJson.dependencies) {
          Object.entries(packageJson.dependencies).forEach(
            ([name, version]) => {
              deps[name] = String(version);
            }
          );
        }

        if (packageJson.devDependencies) {
          Object.entries(packageJson.devDependencies).forEach(
            ([name, version]) => {
              deps[name] = String(version);
            }
          );
        }
      }
    } catch (err) {
      // 忽略错误

      handleError(err, {
        module: 'performance:StartupReport',
        action: 'readPackageJson',
      });
    }

    return deps;
  }

  /**
   * 显示报告
   */
  public displayReport(): void {
    const report = this.generateReport();
    console.log('='.repeat(80));
    console.log('STARTUP PERFORMANCE REPORT');
    console.log('='.repeat(80));
    console.log(`Total Duration: ${report.totalDuration.toFixed(2)}ms`);
    console.log('');

    if (this.config.includeMemory) {
      console.log('MEMORY USAGE:');
      console.log(
        `  Initial Heap: ${(report.memory.initial.heapUsed / 1024 / 1024).toFixed(2)}MB`
      );
      console.log(
        `  Final Heap: ${(report.memory.final.heapUsed / 1024 / 1024).toFixed(2)}MB`
      );
      console.log(
        `  Initial RSS: ${(report.memory.initial.rss / 1024 / 1024).toFixed(2)}MB`
      );
      console.log(
        `  Final RSS: ${(report.memory.final.rss / 1024 / 1024).toFixed(2)}MB`
      );
      console.log('');
    }

    if (this.config.includeCheckpoints && report.checkpoints.length > 0) {
      console.log('CHECKPOINTS:');
      report.checkpoints.forEach((cp, index) => {
        const previousDuration =
          index > 0 ? report.checkpoints[index - 1].duration : 0;
        const stageDuration = cp.duration - previousDuration;
        console.log(
          `  ${cp.name}: ${stageDuration.toFixed(2)}ms (${cp.duration.toFixed(2)}ms total)`
        );
      });
      console.log('');
    }

    console.log('='.repeat(80));
  }

  /**
   * 设置配置
   */
  public setConfig(config: Partial<StartupReportConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 获取配置
   */
  public getConfig(): StartupReportConfig {
    return { ...this.config };
  }

  /**
   * 重置服务
   */
  public reset(): void {
    this.startTime = Date.now();
    this.checkpoints = [];
    this.endTime = null;
    this.initialMemory = null;
    this.finalMemory = null;
  }

  /**
   * 获取检查点
   */
  public getCheckpoints(): StartupCheckpoint[] {
    return [...this.checkpoints];
  }

  /**
   * 获取启动时间
   */
  public getStartTime(): number {
    return this.startTime;
  }

  /**
   * 获取结束时间
   */
  public getEndTime(): number | null {
    return this.endTime;
  }

  /**
   * 获取启动路径
   */
  public getStartupPerfLogPath(): string {
    return this.config.reportPath;
  }
}

/**
 * 导出单例
 */
export const startupReportService = StartupReportService.getInstance();

/**
 * 启动报告便捷函数
 */
export function getStartupReportService(): StartupReportService {
  return startupReportService;
}

/**
 * 开始启动计时
 */
export function startStartupReport(): void {
  startupReportService.start();
}

/**
 * 结束启动计时
 */
export function endStartupReport(): void {
  startupReportService.end();
}

/**
 * 添加启动检查点
 */
export function addStartupCheckpoint(
  name: string,
  details?: Record<string, unknown>
): void {
  startupReportService.checkpoint(name, details);
}

/**
 * 生成启动报告
 */
export function generateStartupReport(): StartupReport {
  return startupReportService.generateReport();
}

/**
 * 显示启动报告
 */
export function displayStartupReport(): void {
  startupReportService.displayReport();
}

/**
 * 获取启动性能日志路径
 */
export function getStartupPerfLogPath(): string {
  return startupReportService.getStartupPerfLogPath();
}
