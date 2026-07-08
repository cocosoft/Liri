/**
 * LogDiagnostic 日志诊断
 * 对标 CC 的日志诊断能力
 */
import fs from 'fs';
import { handleError } from '@modules/error';

/**
 * 诊断配置
 */
export interface DiagnosticConfig {
  logPath: string;
  errorThreshold: number;
  warnThreshold: number;
  checkInterval: number;
}

/**
 * 诊断检查
 */
export interface DiagnosticCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  value?: unknown;
}

/**
 * 诊断结果
 */
export interface DiagnosticResult {
  timestamp: number;
  overall: 'healthy' | 'degraded' | 'unhealthy';
  checks: DiagnosticCheck[];
  stats: {
    totalLines: number;
    errorCount: number;
    warnCount: number;
    infoCount: number;
    oldestEntry: number;
    newestEntry: number;
  };
}

/**
 * 日志诊断器
 */
export class LogDiagnostic {
  private config: DiagnosticConfig;

  constructor(config?: Partial<DiagnosticConfig>) {
    this.config = {
      logPath: config?.logPath || '',
      errorThreshold: config?.errorThreshold || 100,
      warnThreshold: config?.warnThreshold || 500,
      checkInterval: config?.checkInterval || 60 * 1000,
    };
  }

  /**
   * 执行诊断
   */
  async diagnose(logPath?: string): Promise<DiagnosticResult> {
    const path = logPath || this.config.logPath;
    const checks: DiagnosticCheck[] = [];

    checks.push(this.checkFileExists(path));
    checks.push(this.checkFileSize(path));
    checks.push(this.checkFilePermissions(path));

    const stats = await this.analyzeLogFile(path);
    checks.push(this.checkErrorRate(stats));
    checks.push(this.checkLogRecency(stats));

    const errorChecks = checks.filter((c) => c.status === 'fail');
    const warnChecks = checks.filter((c) => c.status === 'warn');

    const overall =
      errorChecks.length > 0
        ? 'unhealthy'
        : warnChecks.length > 2
          ? 'degraded'
          : 'healthy';

    return {
      timestamp: Date.now(),
      overall,
      checks,
      stats,
    };
  }

  /**
   * 检查文件存在
   */
  private checkFileExists(path: string): DiagnosticCheck {
    const exists = fs.existsSync(path);

    return {
      name: '日志文件存在',
      status: exists ? 'pass' : 'fail',
      message: exists ? `日志文件存在: ${path}` : `日志文件不存在: ${path}`,
      value: exists,
    };
  }

  /**
   * 检查文件大小
   */
  private checkFileSize(path: string): DiagnosticCheck {
    try {
      if (!fs.existsSync(path)) {
        return { name: '文件大小', status: 'fail', message: '文件不存在' };
      }

      const size = fs.statSync(path).size;
      const sizeMB = size / (1024 * 1024);

      if (sizeMB > 500) {
        return {
          name: '文件大小',
          status: 'warn',
          message: `文件过大: ${sizeMB.toFixed(1)}MB`,
          value: size,
        };
      }

      return {
        name: '文件大小',
        status: 'pass',
        message: `文件大小: ${sizeMB.toFixed(1)}MB`,
        value: size,
      };
    } catch (err) {
      return {
        name: '文件大小',
        status: 'fail',
        message: `检查失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * 检查文件权限
   */
  private checkFilePermissions(path: string): DiagnosticCheck {
    try {
      if (!fs.existsSync(path)) {
        return { name: '文件权限', status: 'fail', message: '文件不存在' };
      }

      fs.accessSync(path, fs.constants.R_OK);

      return { name: '文件权限', status: 'pass', message: '文件可读' };
    } catch {
      return { name: '文件权限', status: 'fail', message: '文件不可读' };
    }
  }

  /**
   * 分析日志文件
   */
  private async analyzeLogFile(
    path: string
  ): Promise<DiagnosticResult['stats']> {
    const stats: DiagnosticResult['stats'] = {
      totalLines: 0,
      errorCount: 0,
      warnCount: 0,
      infoCount: 0,
      oldestEntry: 0,
      newestEntry: 0,
    };

    try {
      if (!fs.existsSync(path)) return stats;

      const content = fs.readFileSync(path, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());

      stats.totalLines = lines.length;

      const timestamps: number[] = [];

      for (const line of lines.slice(-10000)) {
        if (/\bERROR?\b/i.test(line)) stats.errorCount++;
        if (/\bWARN?\b/i.test(line)) stats.warnCount++;
        if (/\bINFO?\b/i.test(line)) stats.infoCount++;

        const tsMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
        if (tsMatch) {
          timestamps.push(new Date(tsMatch[1]).getTime());
        }
      }

      if (timestamps.length > 0) {
        stats.oldestEntry = Math.min(...timestamps);
        stats.newestEntry = Math.max(...timestamps);
      }
    } catch (err) {
      void handleError(err, {
        module: 'monitoring:logs',
        action: 'catch_error',
      });
    }

    return stats;
  }

  /**
   * 检查错误率
   */
  private checkErrorRate(stats: DiagnosticResult['stats']): DiagnosticCheck {
    const errorRate =
      stats.totalLines > 0 ? stats.errorCount / stats.totalLines : 0;

    if (errorRate > 0.1) {
      return {
        name: '错误率',
        status: 'fail',
        message: `错误率过高: ${(errorRate * 100).toFixed(1)}%`,
        value: errorRate,
      };
    }

    if (errorRate > 0.05) {
      return {
        name: '错误率',
        status: 'warn',
        message: `错误率偏高: ${(errorRate * 100).toFixed(1)}%`,
        value: errorRate,
      };
    }

    return {
      name: '错误率',
      status: 'pass',
      message: `错误率正常: ${(errorRate * 100).toFixed(1)}%`,
      value: errorRate,
    };
  }

  /**
   * 检查日志时效性
   */
  private checkLogRecency(stats: DiagnosticResult['stats']): DiagnosticCheck {
    if (stats.newestEntry === 0) {
      return {
        name: '日志时效',
        status: 'warn',
        message: '无法确定最新日志时间',
      };
    }

    const age = Date.now() - stats.newestEntry;

    if (age > 24 * 60 * 60 * 1000) {
      return {
        name: '日志时效',
        status: 'warn',
        message: `日志最后更新: ${Math.round(age / 3600000)}小时前`,
        value: age,
      };
    }

    return {
      name: '日志时效',
      status: 'pass',
      message: `日志最后更新: ${Math.round(age / 60000)}分钟前`,
      value: age,
    };
  }
}

export const logDiagnostic = new LogDiagnostic();
