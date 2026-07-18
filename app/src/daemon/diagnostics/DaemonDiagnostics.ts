/**
 * DaemonDiagnostics 守护进程诊断工具
 * 对标 CC 的 --daemon-diagnostics 机制
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { DiskSpaceMonitor } from '../../core/delivery/monitor/DiskSpaceMonitor';
import { resolvePyappHome } from '@modules/core';
import { configManager } from '@modules/config';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'daemon:diagnostics:DaemonDiagnostics', level: LogLevel.INFO });

/**
 * 诊断级别
 */
export type DiagnosticsLevel = 'basic' | 'standard' | 'full';

/**
 * 诊断检查项
 */
export interface DiagnosticsCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  value?: string;
}

/**
 * 诊断结果
 */
export interface DiagnosticsResult {
  timestamp: number;
  level: DiagnosticsLevel;
  system: {
    platform: string;
    release: string;
    hostname: string;
    uptime: number;
    loadAvg: number[];
    memory: { total: number; free: number; usagePercent: number };
    cpu: { cores: number; model: string };
  };
  process: {
    pid: number;
    uptime: number;
    memory: { rss: number; heapTotal: number; heapUsed: number };
    nodeVersion: string;
    cwd: string;
  };
  checks: DiagnosticsCheck[];
  summary: { pass: number; warn: number; fail: number };
}

/**
 * 守护进程诊断工具
 */
export class DaemonDiagnostics {
  private diskSpaceMonitor: DiskSpaceMonitor;

  constructor() {
    this.diskSpaceMonitor = new DiskSpaceMonitor();
  }

  /**
   * 运行诊断
   */
  run(level: DiagnosticsLevel = 'standard'): DiagnosticsResult {
    const checks: DiagnosticsCheck[] = [];

    checks.push(this.checkPidFile());
    checks.push(this.checkLogFile());
    checks.push(this.checkSocketFile());

    if (level === 'standard' || level === 'full') {
      checks.push(this.checkDiskSpace());
      checks.push(this.checkComprehensiveDiskSpace());
      checks.push(this.checkMemoryUsage());
      checks.push(this.checkFileDescriptors());
      checks.push(this.checkNetworkConnectivity());
      checks.push(this.checkDependencies());
    }

    if (level === 'full') {
      checks.push(this.checkSystemLogs());
      checks.push(this.checkCrashReports());
      checks.push(this.checkPerformanceMetrics());
      checks.push(this.checkSecurityStatus());
    }

    const summary = {
      pass: checks.filter((c) => c.status === 'pass').length,
      warn: checks.filter((c) => c.status === 'warn').length,
      fail: checks.filter((c) => c.status === 'fail').length,
    };

    const memInfo = process.memoryUsage();
    const cpus = os.cpus();

    return {
      timestamp: Date.now(),
      level,
      system: {
        platform: os.platform(),
        release: os.release(),
        hostname: os.hostname(),
        uptime: os.uptime(),
        loadAvg: os.loadavg(),
        memory: {
          total: os.totalmem(),
          free: os.freemem(),
          usagePercent: (1 - os.freemem() / os.totalmem()) * 100,
        },
        cpu: {
          cores: cpus.length,
          model: cpus[0]?.model || 'unknown',
        },
      },
      process: {
        pid: process.pid,
        uptime: process.uptime(),
        memory: {
          rss: memInfo.rss,
          heapTotal: memInfo.heapTotal,
          heapUsed: memInfo.heapUsed,
        },
        nodeVersion: process.version,
        cwd: process.cwd(),
      },
      checks,
      summary,
    };
  }

  /**
   * 检查 PID 文件
   */
  private checkPidFile(): DiagnosticsCheck {
    const pidPath = this.getPidPath();

    try {
      if (fs.existsSync(pidPath)) {
        const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);

        try {
          process.kill(pid, 0);
          return {
            name: 'pid-file',
            status: 'pass',
            message: `PID 文件存在，进程运行中 (PID: ${pid})`,
            value: String(pid),
          };
        } catch {
          return {
            name: 'pid-file',
            status: 'warn',
            message: `PID 文件存在但进程 ${pid} 未运行`,
            value: String(pid),
          };
        }
      }

      return {
        name: 'pid-file',
        status: 'pass',
        message: 'PID 文件不存在（守护进程未安装）',
      };
    } catch (err) {
      return {
        name: 'pid-file',
        status: 'fail',
        message: `读取 PID 文件失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * 检查日志文件
   */
  private checkLogFile(): DiagnosticsCheck {
    const logDir = path.join(resolvePyappHome(), 'daemon', 'logs');

    try {
      if (fs.existsSync(logDir)) {
        const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));

        if (files.length === 0) {
          return {
            name: 'log-file',
            status: 'warn',
            message: '日志目录存在但没有日志文件',
          };
        }

        const totalSize = files.reduce((sum, f) => {
          return sum + fs.statSync(path.join(logDir, f)).size;
        }, 0);

        return {
          name: 'log-file',
          status: 'pass',
          message: `日志目录存在，${files.length} 个文件 (${this.formatBytes(totalSize)})`,
          value: `${files.length} files, ${this.formatBytes(totalSize)}`,
        };
      }

      return {
        name: 'log-file',
        status: 'fail',
        message: '日志目录不存在',
      };
    } catch (err) {
      return {
        name: 'log-file',
        status: 'fail',
        message: `检查日志失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * 检查 Socket 文件
   */
  private checkSocketFile(): DiagnosticsCheck {
    const socketPath = path.join(resolvePyappHome(), 'daemon', 'pyapp.sock');

    try {
      if (fs.existsSync(socketPath)) {
        return {
          name: 'socket-file',
          status: 'pass',
          message: 'Socket 文件存在',
          value: socketPath,
        };
      }

      return {
        name: 'socket-file',
        status: 'pass',
        message: 'Socket 文件不存在（可能未启用 IPC）',
      };
    } catch (err) {
      return {
        name: 'socket-file',
        status: 'fail',
        message: `检查 Socket 失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * 检查磁盘空间
   */
  private checkDiskSpace(): DiagnosticsCheck {
    try {
      const pyAppDir = resolvePyappHome();

      if (fs.existsSync(pyAppDir)) {
        const stats = fs.statfsSync(pyAppDir);
        const freeGB = (stats.bfree * stats.bsize) / (1024 * 1024 * 1024);

        if (freeGB < 1) {
          return {
            name: 'disk-space',
            status: 'fail',
            message: `磁盘空间不足: ${freeGB.toFixed(2)} GB 可用`,
            value: `${freeGB.toFixed(2)} GB`,
          };
        }

        if (freeGB < 5) {
          return {
            name: 'disk-space',
            status: 'warn',
            message: `磁盘空间较低: ${freeGB.toFixed(2)} GB 可用`,
            value: `${freeGB.toFixed(2)} GB`,
          };
        }

        return {
          name: 'disk-space',
          status: 'pass',
          message: `磁盘空间充足: ${freeGB.toFixed(2)} GB 可用`,
          value: `${freeGB.toFixed(2)} GB`,
        };
      }

      return {
        name: 'disk-space',
        status: 'pass',
        message: '应用目录不存在，无需检查',
      };
    } catch {
      return {
        name: 'disk-space',
        status: 'warn',
        message: '无法检查磁盘空间',
      };
    }
  }

  /**
   * 使用 DiskSpaceMonitor 检查所有磁盘
   */
  private checkComprehensiveDiskSpace(): DiagnosticsCheck {
    try {
      const disks = this.diskSpaceMonitor.check();

      if (disks.length === 0) {
        return {
          name: 'disk-usage-all',
          status: 'warn',
          message: '无法获取磁盘信息',
        };
      }

      const highUsage = disks.filter((d) => d.usagePercent >= 90);
      const warnUsage = disks.filter(
        (d) => d.usagePercent >= 80 && d.usagePercent < 90
      );

      if (highUsage.length > 0) {
        const details = highUsage
          .map((d) => `${d.drive} ${d.usagePercent.toFixed(1)}%`)
          .join(', ');
        return {
          name: 'disk-usage-all',
          status: 'fail',
          message: `磁盘使用率过高: ${details}`,
          value: `${highUsage.length} drives critical`,
        };
      }

      if (warnUsage.length > 0) {
        const details = warnUsage
          .map((d) => `${d.drive} ${d.usagePercent.toFixed(1)}%`)
          .join(', ');
        return {
          name: 'disk-usage-all',
          status: 'warn',
          message: `磁盘使用率偏高: ${details}`,
          value: `${warnUsage.length} drives warning`,
        };
      }

      const allDisks = disks
        .map((d) => `${d.drive} ${d.usagePercent.toFixed(1)}%`)
        .join(', ');
      return {
        name: 'disk-usage-all',
        status: 'pass',
        message: `所有磁盘使用率正常`,
        value: allDisks,
      };
    } catch {
      return {
        name: 'disk-usage-all',
        status: 'warn',
        message: '无法检查磁盘使用率',
      };
    }
  }

  /**
   * 检查内存使用
   */
  private checkMemoryUsage(): DiagnosticsCheck {
    const mem = process.memoryUsage();
    const heapPercent = (mem.heapUsed / mem.heapTotal) * 100;

    if (heapPercent > 90) {
      return {
        name: 'memory-usage',
        status: 'fail',
        message: `堆内存使用过高: ${heapPercent.toFixed(1)}%`,
        value: `${this.formatBytes(mem.heapUsed)} / ${this.formatBytes(mem.heapTotal)}`,
      };
    }

    if (heapPercent > 70) {
      return {
        name: 'memory-usage',
        status: 'warn',
        message: `堆内存使用偏高: ${heapPercent.toFixed(1)}%`,
        value: `${this.formatBytes(mem.heapUsed)} / ${this.formatBytes(mem.heapTotal)}`,
      };
    }

    return {
      name: 'memory-usage',
      status: 'pass',
      message: `堆内存使用正常: ${heapPercent.toFixed(1)}%`,
      value: `${this.formatBytes(mem.heapUsed)} / ${this.formatBytes(mem.heapTotal)}`,
    };
  }

  /**
   * 检查文件描述符
   */
  private checkFileDescriptors(): DiagnosticsCheck {
    try {
      if (os.platform() !== 'win32') {
        const output = execSync('ulimit -n', {
          encoding: 'utf-8',
          stdio: 'pipe',
        })
          .toString()
          .trim();
        const limit = parseInt(output, 10);

        if (limit < 1024) {
          return {
            name: 'file-descriptors',
            status: 'warn',
            message: `文件描述符限制较低: ${limit}`,
            value: String(limit),
          };
        }

        return {
          name: 'file-descriptors',
          status: 'pass',
          message: `文件描述符限制: ${limit}`,
          value: String(limit),
        };
      }

      return {
        name: 'file-descriptors',
        status: 'pass',
        message: 'Windows 平台跳过此检查',
      };
    } catch {
      return {
        name: 'file-descriptors',
        status: 'warn',
        message: '无法检查文件描述符',
      };
    }
  }

  /**
   * 检查网络连通性
   */
  private checkNetworkConnectivity(): DiagnosticsCheck {
    try {
      execSync('ping -c 1 -W 2 8.8.8.8', {
        stdio: 'pipe',
        timeout: 5000,
        encoding: 'utf-8',
      });
      return {
        name: 'network',
        status: 'pass',
        message: '网络连接正常',
      };
    } catch {
      try {
        execSync('ping -n 1 -w 2000 8.8.8.8', {
          stdio: 'pipe',
          timeout: 5000,
          encoding: 'utf-8',
          shell: 'cmd.exe',
        });
        return {
          name: 'network',
          status: 'pass',
          message: '网络连接正常',
        };
      } catch {
        return {
          name: 'network',
          status: 'warn',
          message: '无法 ping 通外部地址，可能无网络连接',
        };
      }
    }
  }

  /**
   * 检查依赖
   */
  private checkDependencies(): DiagnosticsCheck {
    try {
      const output = execSync('node --version', {
        encoding: 'utf-8',
        stdio: 'pipe',
      })
        .toString()
        .trim();
      return {
        name: 'dependencies',
        status: 'pass',
        message: `Node.js ${output}`,
        value: output,
      };
    } catch (err) {
      return {
        name: 'dependencies',
        status: 'fail',
        message: `Node.js 未找到: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * 检查系统日志
   */
  private checkSystemLogs(): DiagnosticsCheck {
    try {
      const logDir = path.join(resolvePyappHome(), 'daemon', 'logs');

      if (fs.existsSync(logDir)) {
        const logFiles = fs
          .readdirSync(logDir)
          .filter((f) => f.endsWith('.log'))
          .map((f) => path.join(logDir, f))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
          .slice(0, 3);

        return {
          name: 'system-logs',
          status: 'pass',
          message: `最近日志: ${logFiles.map((f) => path.basename(f)).join(', ')}`,
          value: `${logFiles.length} files`,
        };
      }

      return {
        name: 'system-logs',
        status: 'warn',
        message: '系统日志目录不存在',
      };
    } catch (err) {
      return {
        name: 'system-logs',
        status: 'warn',
        message: `检查系统日志失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * 检查崩溃报告
   */
  private checkCrashReports(): DiagnosticsCheck {
    try {
      const crashDir = path.join(resolvePyappHome(), 'daemon', 'crashes');

      if (fs.existsSync(crashDir)) {
        const crashFiles = fs.readdirSync(crashDir);

        if (crashFiles.length > 0) {
          return {
            name: 'crash-reports',
            status: 'warn',
            message: `${crashFiles.length} 个崩溃报告存在`,
            value: String(crashFiles.length),
          };
        }

        return {
          name: 'crash-reports',
          status: 'pass',
          message: '无崩溃报告',
        };
      }

      return {
        name: 'crash-reports',
        status: 'pass',
        message: '无崩溃报告目录',
      };
    } catch {
      return {
        name: 'crash-reports',
        status: 'warn',
        message: '无法检查崩溃报告',
      };
    }
  }

  /**
   * 检查性能指标
   */
  private checkPerformanceMetrics(): DiagnosticsCheck {
    const mem = process.memoryUsage();
    const heapGrowth = mem.heapUsed > 500 * 1024 * 1024;

    return {
      name: 'performance',
      status: heapGrowth ? 'warn' : 'pass',
      message: heapGrowth
        ? `堆内存使用较高: ${this.formatBytes(mem.heapUsed)}`
        : `性能指标正常`,
      value: `RSS: ${this.formatBytes(mem.rss)}, Heap: ${this.formatBytes(mem.heapUsed)}`,
    };
  }

  /**
   * 检查安全状态
   */
  private checkSecurityStatus(): DiagnosticsCheck {
    const isRoot = process.getuid && process.getuid() === 0;
    const isProduction = configManager.env('NODE_ENV') === 'production';

    return {
      name: 'security',
      status: isRoot ? 'warn' : 'pass',
      message: isRoot
        ? '警告：以 root 权限运行'
        : `运行模式: ${isProduction ? 'production' : 'development'}`,
      value: isProduction ? 'production' : 'development',
    };
  }

  /**
   * 获取 PID 文件路径
   */
  private getPidPath(): string {
    return path.join(resolvePyappHome(), 'daemon', 'pyapp.pid');
  }

  /**
   * 格式化字节
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

export const daemonDiagnostics = new DaemonDiagnostics();
