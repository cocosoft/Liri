/**
 * 系统健康检查服务
 * 提供系统资源检测和健康状态评估功能
 * 参考CC源码: cc_code/backend/utils/doctorDiagnostic.ts
 */

import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import { freemem, totalmem, cpus, loadavg, platform, arch, homedir } from 'os';
import { existsSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';
import { resolvePyappHome, resolveProjectRoot } from '@modules/core/paths';

const _require = createRequire(import.meta.url);
const execAsync = promisify(exec);

/**
 * 健康状态
 */
export type HealthStatus = 'healthy' | 'warning' | 'critical';

/**
 * 资源使用情况
 */
export interface ResourceUsage {
  cpu: {
    usage: number;
    loadAverage: number[];
    cores: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  };
  disk: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  };
}

/**
 * 健康检查项
 */
export interface HealthCheckItem {
  name: string;
  status: HealthStatus;
  message: string;
  value?: number;
  threshold?: number;
  suggestions?: string[];
}

/**
 * 系统健康报告
 */
export interface SystemHealthReport {
  overallStatus: HealthStatus;
  timestamp: number;
  checks: HealthCheckItem[];
  resourceUsage: ResourceUsage;
  recommendations: string[];
}

/**
 * 系统健康检查服务类
 */
export class SystemHealthChecker extends EventEmitter {
  private static instance: SystemHealthChecker;
  private lastReport: SystemHealthReport | null = null;

  private constructor() {
    super();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): SystemHealthChecker {
    if (!SystemHealthChecker.instance) {
      SystemHealthChecker.instance = new SystemHealthChecker();
    }
    return SystemHealthChecker.instance;
  }

  /**
   * 执行完整健康检查
   */
  async performFullCheck(): Promise<SystemHealthReport> {
    const checks: HealthCheckItem[] = [];
    const recommendations: string[] = [];

    checks.push(await this.checkCpuUsage());
    checks.push(await this.checkMemoryUsage());
    checks.push(await this.checkDiskSpace());
    checks.push(await this.checkSystemUptime());
    checks.push(await this.checkEnvironmentVariables());
    checks.push(await this.checkPermissions());
    checks.push(await this.checkApplicationConfig());
    checks.push(await this.checkOptionalDependencies());

    const overallStatus = this.determineOverallStatus(checks);
    const resourceUsage = await this.getResourceUsage();

    for (const check of checks) {
      if (check.suggestions) {
        recommendations.push(...check.suggestions);
      }
    }

    this.lastReport = {
      overallStatus,
      timestamp: Date.now(),
      checks,
      resourceUsage,
      recommendations,
    };

    this.emit('healthCheck', this.lastReport);

    return this.lastReport;
  }

  /**
   * 检查CPU使用率
   */
  private async checkCpuUsage(): Promise<HealthCheckItem> {
    const loadAvg = loadavg();
    const cpuCount = cpus().length;
    const usage = (loadAvg[0] / cpuCount) * 100;

    let status: HealthStatus = 'healthy';
    let message = `CPU使用率正常: ${usage.toFixed(2)}%`;
    const suggestions: string[] = [];

    if (usage > 90) {
      status = 'critical';
      message = `CPU使用率过高: ${usage.toFixed(2)}%`;
      suggestions.push('关闭不必要的进程');
      suggestions.push('检查是否有CPU密集型任务运行');
    } else if (usage > 70) {
      status = 'warning';
      message = `CPU使用率较高: ${usage.toFixed(2)}%`;
      suggestions.push('监控系统性能');
    }

    return {
      name: 'CPU使用率',
      status,
      message,
      value: usage,
      threshold: 70,
      suggestions,
    };
  }

  /**
   * 检查内存使用率
   */
  private async checkMemoryUsage(): Promise<HealthCheckItem> {
    const total = totalmem();
    const free = freemem();
    const used = total - free;
    const usagePercent = (used / total) * 100;

    let status: HealthStatus = 'healthy';
    let message = `内存使用率正常: ${usagePercent.toFixed(2)}%`;
    const suggestions: string[] = [];

    if (usagePercent > 90) {
      status = 'critical';
      message = `内存使用率过高: ${usagePercent.toFixed(2)}%`;
      suggestions.push('关闭不必要的应用程序');
      suggestions.push('检查内存泄漏');
    } else if (usagePercent > 80) {
      status = 'warning';
      message = `内存使用率较高: ${usagePercent.toFixed(2)}%`;
      suggestions.push('监控内存使用情况');
    }

    return {
      name: '内存使用率',
      status,
      message,
      value: usagePercent,
      threshold: 80,
      suggestions,
    };
  }

  /**
   * 检查磁盘空间
   */
  private async checkDiskSpace(): Promise<HealthCheckItem> {
    try {
      const currentPlatform = platform();
      let diskInfo: { total: number; free: number };

      if (currentPlatform === 'win32') {
        diskInfo = await this.getWindowsDiskInfo();
      } else {
        diskInfo = await this.getUnixDiskInfo();
      }

      const { total, free } = diskInfo;
      const used = total - free;
      const usagePercent = (used / total) * 100;

      let status: HealthStatus = 'healthy';
      let message = `磁盘使用率正常: ${usagePercent.toFixed(2)}%`;
      const suggestions: string[] = [];

      if (usagePercent > 95) {
        status = 'critical';
        message = `磁盘空间不足: ${usagePercent.toFixed(2)}%`;
        suggestions.push('清理不必要的文件');
        suggestions.push('检查大文件和日志');
      } else if (usagePercent > 85) {
        status = 'warning';
        message = `磁盘空间较少: ${usagePercent.toFixed(2)}%`;
        suggestions.push('考虑清理磁盘空间');
      }

      return {
        name: '磁盘空间',
        status,
        message,
        value: usagePercent,
        threshold: 85,
        suggestions,
      };
    } catch (error) {
      return {
        name: '磁盘空间',
        status: 'warning',
        message: '无法获取磁盘信息',
        suggestions: ['检查磁盘权限'],
      };
    }
  }

  /**
   * 获取Windows磁盘信息
   */
  private async getWindowsDiskInfo(): Promise<{ total: number; free: number }> {
    try {
      const { stdout } = await (execAsync as any)(
        'wmic logicaldisk get size,freespace',
        {
          shell: true,
        }
      );
      const lines = stdout.trim().split('\n').slice(1);
      let total = 0;
      let free = 0;

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          free += parseInt(parts[0]) || 0;
          total += parseInt(parts[1]) || 0;
        }
      }

      return { total, free };
    } catch {
      return { total: 0, free: 0 };
    }
  }

  /**
   * 获取Unix磁盘信息
   */
  private async getUnixDiskInfo(): Promise<{ total: number; free: number }> {
    try {
      const { stdout } = await (execAsync as any)('df -k / | tail -1', {
        shell: true,
      });
      const parts = stdout.trim().split(/\s+/);

      if (parts.length >= 4) {
        const total = parseInt(parts[1]) * 1024;
        const free = parseInt(parts[3]) * 1024;
        return { total, free };
      }

      return { total: 0, free: 0 };
    } catch {
      return { total: 0, free: 0 };
    }
  }

  /**
   * 检查系统运行时间
   */
  private async checkSystemUptime(): Promise<HealthCheckItem> {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    return {
      name: '系统运行时间',
      status: 'healthy',
      message: `系统已运行 ${hours}小时 ${minutes}分钟`,
      value: uptime,
    };
  }

  /**
   * 检查环境变量
   */
  private async checkEnvironmentVariables(): Promise<HealthCheckItem> {
    const warnings: string[] = [];
    const suggestions: string[] = [];

    if (!process.env.OAUTH_ENCRYPTION_KEY) {
      warnings.push('OAUTH_ENCRYPTION_KEY');
      suggestions.push(
        '设置 OAUTH_ENCRYPTION_KEY 环境变量以确保 OAuth 令牌加密安全'
      );
    }

    if (warnings.length > 0) {
      return {
        name: '环境变量',
        status: 'warning',
        message: `缺少推荐环境变量: ${warnings.join(', ')}`,
        suggestions,
      };
    }

    return {
      name: '环境变量',
      status: 'healthy',
      message: '所有必需的环境变量都已设置',
    };
  }

  /**
   * 检查权限
   */
  private async checkPermissions(): Promise<HealthCheckItem> {
    const currentPlatform = platform();
    const suggestions: string[] = [];

    if (currentPlatform !== 'win32') {
      const uid = process.getuid?.();
      if (uid === 0) {
        return {
          name: '权限检查',
          status: 'warning',
          message: '以root用户运行，存在安全风险',
          suggestions: ['使用非root用户运行应用'],
        };
      }
    }

    return {
      name: '权限检查',
      status: 'healthy',
      message: '权限设置正常',
    };
  }

  /**
   * 检查应用配置完整性
   * 验证项目根目录、预置目录、用户档案文件等应用级配置
   */
  private async checkApplicationConfig(): Promise<HealthCheckItem> {
    const issues: string[] = [];
    const suggestions: string[] = [];

    const projectRoot = resolveProjectRoot();
    const pyappDir = resolvePyappHome();

    if (
      !existsSync(
        join(projectRoot, 'app', 'src', 'monitoring', 'alerts', 'presets')
      )
    ) {
      issues.push('告警预置目录不存在');
      suggestions.push('确认 presets 目录存在于项目源码中');
    }

    if (!existsSync(join(pyappDir, 'SOUL.md'))) {
      issues.push('~/.pyapp/SOUL.md 不存在');
      suggestions.push(
        'SOUL.md 会在首次启动时自动创建，手动创建可自定义 AI 人格'
      );
    }

    if (!existsSync(join(pyappDir, 'USER.md'))) {
      issues.push('~/.pyapp/USER.md 不存在');
      suggestions.push(
        'USER.md 会在首次启动时自动创建，手动创建可自定义用户身份'
      );
    }

    if (issues.length > 0) {
      return {
        name: '应用配置',
        status: 'warning',
        message: issues.join('; '),
        suggestions,
      };
    }

    return {
      name: '应用配置',
      status: 'healthy',
      message: '应用配置完整',
    };
  }

  /**
   * 检查可选依赖安装状态
   * 包括外部命令和 npm 可选包两部分
   */
  private async checkOptionalDependencies(): Promise<HealthCheckItem> {
    const { checkExternalCommands } = await import('./DependenciesChecker.js');
    const extResult = await checkExternalCommands();

    const npmMissing: string[] = [];
    const npmSuggestions: string[] = [];

    const deps: Record<string, string> = {
      'pdfjs-dist': 'PDF 文档转换',
    };

    for (const [pkg, purpose] of Object.entries(deps)) {
      try {
        _require.resolve(pkg);
      } catch {
        npmMissing.push(`${pkg}（${purpose}）`);
        npmSuggestions.push(
          `运行 bun add ${pkg} 安装可选依赖以启用 ${purpose} 功能`
        );
      }
    }

    const missingCommands = extResult.items.filter((i) => !i.found);
    const missingNpm = npmMissing.length > 0;

    if (missingCommands.length === 0 && !missingNpm) {
      return {
        name: '可选依赖',
        status: 'healthy',
        message: '所有可选依赖已安装',
      };
    }

    const parts: string[] = [];
    const allSuggestions: string[] = [
      ...extResult.suggestions,
      ...npmSuggestions,
    ];

    if (missingCommands.length > 0) {
      parts.push(
        `缺少外部命令: ${missingCommands.map((i) => i.command).join(', ')}`
      );
    }
    if (missingNpm) {
      parts.push(`缺少 npm 包: ${npmMissing.join(', ')}`);
    }

    return {
      name: '可选依赖',
      status: 'warning',
      message: parts.join('; '),
      suggestions: allSuggestions,
    };
  }

  /**
   * 获取资源使用情况
   */
  private async getResourceUsage(): Promise<ResourceUsage> {
    const cpuInfo = cpus();
    const loadAvg = loadavg();
    const total = totalmem();
    const free = freemem();

    let diskInfo: { total: number; free: number };
    const currentPlatform = platform();

    if (currentPlatform === 'win32') {
      diskInfo = await this.getWindowsDiskInfo();
    } else {
      diskInfo = await this.getUnixDiskInfo();
    }

    return {
      cpu: {
        usage: (loadAvg[0] / cpuInfo.length) * 100,
        loadAverage: loadAvg,
        cores: cpuInfo.length,
      },
      memory: {
        total,
        free,
        used: total - free,
        usagePercent: ((total - free) / total) * 100,
      },
      disk: {
        total: diskInfo.total,
        free: diskInfo.free,
        used: diskInfo.total - diskInfo.free,
        usagePercent:
          diskInfo.total > 0
            ? ((diskInfo.total - diskInfo.free) / diskInfo.total) * 100
            : 0,
      },
    };
  }

  /**
   * 确定整体状态
   */
  private determineOverallStatus(checks: HealthCheckItem[]): HealthStatus {
    if (checks.some((c) => c.status === 'critical')) {
      return 'critical';
    }
    if (checks.some((c) => c.status === 'warning')) {
      return 'warning';
    }
    return 'healthy';
  }

  /**
   * 获取最后一次报告
   */
  getLastReport(): SystemHealthReport | null {
    return this.lastReport;
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.lastReport = null;
    this.removeAllListeners();
  }
}

/**
 * 生成精简版控制台健康报告文本
 * 用于首次运行时向用户展示系统状态概览
 */
export function formatHealthReport(report: SystemHealthReport): string {
  const statusIcon: Record<HealthStatus, string> = {
    healthy: '✅',
    warning: '⚠️',
    critical: '❌',
  };

  const overallText: Record<HealthStatus, string> = {
    healthy: '系统运行正常',
    warning: '存在需要关注的问题',
    critical: '系统运行异常',
  };

  const lines: string[] = [];

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('  📋 系统健康检查报告');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');

  const icon = statusIcon[report.overallStatus];
  lines.push(`  ${icon} 总体状态: ${overallText[report.overallStatus]}`);
  lines.push('');

  for (const check of report.checks) {
    const ci = statusIcon[check.status];
    lines.push(`  ${ci} ${check.name}: ${check.message}`);
  }

  if (report.recommendations.length > 0) {
    lines.push('');
    lines.push('  💡 优化建议:');
    for (const rec of report.recommendations) {
      lines.push(`    · ${rec}`);
    }
  }

  lines.push('');
  lines.push('  📊 资源使用:');
  const cpu = report.resourceUsage.cpu.usage.toFixed(1);
  const mem = report.resourceUsage.memory.usagePercent.toFixed(1);
  const disk = report.resourceUsage.disk.usagePercent.toFixed(1);
  lines.push(`     CPU: ${cpu}%  |  内存: ${mem}%  |  磁盘: ${disk}%`);
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('  输入 /health 查看详情  |  /doctor 深度诊断');
  lines.push('');

  return lines.join('\n');
}

/**
 * 导出单例
 */
export const systemHealthChecker = SystemHealthChecker.getInstance();
