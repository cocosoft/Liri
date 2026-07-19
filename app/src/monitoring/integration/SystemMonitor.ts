//
/**
 * 系统监控集成
 * 提供系统级监控功能
 */

import os from 'os';
import type { NetworkInterfaceInfo } from 'os';
import { logForDebugging } from '@modules/utils/debug.js';
import { errorMessage } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'monitoring\integration\SystemMonitor',
  level: LogLevel.INFO,
});

/**
 * 系统信息
 */
export interface SystemInfo {
  platform: string;
  arch: string;
  hostname: string;
  uptime: number;
  loadAverage: number[];
  totalMemory: number;
  freeMemory: number;
  usedMemory: number;
  memoryUsagePercent: number;
  cpus: number;
  cpuModel: string;
  cpuSpeed: number;
  networkInterfaces: Record<string, os.NetworkInterfaceInfo[]>;
}

/**
 * 进程信息
 */
export interface ProcessInfo {
  pid: number;
  ppid: number;
  title: string;
  version: string;
  versions: Record<string, string>;
  arch: string;
  platform: string;
  env: Record<string, string | undefined>;
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
  resourceUsage: NodeJS.ResourceUsage;
}

/**
 * 磁盘信息
 */
export interface DiskInfo {
  total: number;
  free: number;
  used: number;
  usagePercent: number;
}

/**
 * 系统监控配置
 */
export interface SystemMonitorConfig {
  enabled: boolean;
  interval: number;
  includeDiskInfo: boolean;
  includeNetworkInfo: boolean;
}

/**
 * 系统监控
 */
export class SystemMonitor {
  private config: SystemMonitorConfig;
  private intervalId: NodeJS.Timeout | null;
  private systemInfo: SystemInfo | null;
  private processInfo: ProcessInfo | null;
  private diskInfo: DiskInfo | null;

  /**
   * 构造函数
   * @param config 配置
   */
  constructor(config?: Partial<SystemMonitorConfig>) {
    this.config = {
      enabled: true,
      interval: 5000,
      includeDiskInfo: true,
      includeNetworkInfo: true,
      ...config,
    };

    this.intervalId = null;
    this.systemInfo = null;
    this.processInfo = null;
    this.diskInfo = null;
  }

  /**
   * 启动监控
   */
  start(): void {
    if (!this.config.enabled || this.intervalId) {
      return;
    }

    // 立即收集一次
    this.collect();

    // 启动定时收集
    this.intervalId = setInterval(() => {
      this.collect();
    }, this.config.interval);
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * 收集系统信息
   */
  collect(): void {
    try {
      this.systemInfo = this.getSystemInfo();
      this.processInfo = this.getProcessInfo();

      if (this.config.includeDiskInfo) {
        this.diskInfo = this.getDiskInfo();
      }
    } catch (error) {
      logForDebugging(`收集系统信息失败: ${errorMessage(error)}`, {
        level: 'error',
      });
    }
  }

  /**
   * 获取系统信息
   * @returns 系统信息
   */
  getSystemInfo(): SystemInfo {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    return {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      loadAverage: os.loadavg(),
      totalMemory,
      freeMemory,
      usedMemory,
      memoryUsagePercent: (usedMemory / totalMemory) * 100,
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || 'unknown',
      cpuSpeed: os.cpus()[0]?.speed || 0,
      networkInterfaces: this.config.includeNetworkInfo
        ? (os.networkInterfaces() as Record<string, NetworkInterfaceInfo[]>)
        : {},
    };
  }

  /**
   * 获取进程信息
   * @returns 进程信息
   */
  getProcessInfo(): ProcessInfo {
    return {
      pid: process.pid,
      ppid: process.ppid,
      title: process.title,
      version: process.version,
      versions: process.versions as Record<string, string>,
      arch: process.arch,
      platform: process.platform,
      env: process.env as Record<string, string | undefined>,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      resourceUsage: process.resourceUsage(),
    };
  }

  /**
   * 获取磁盘信息
   * @returns 磁盘信息
   */
  getDiskInfo(): DiskInfo {
    // 简化的磁盘信息，实际实现可能需要调用系统命令
    try {
      if (process.platform === 'win32') {
        // Windows系统
        return {
          total: 0,
          free: 0,
          used: 0,
          usagePercent: 0,
        };
      } else {
        // Unix系统
        return {
          total: 0,
          free: 0,
          used: 0,
          usagePercent: 0,
        };
      }
    } catch {
      return {
        total: 0,
        free: 0,
        used: 0,
        usagePercent: 0,
      };
    }
  }

  /**
   * 获取缓存的系统信息
   * @returns 系统信息
   */
  getCachedSystemInfo(): SystemInfo | null {
    return this.systemInfo;
  }

  /**
   * 获取缓存的进程信息
   * @returns 进程信息
   */
  getCachedProcessInfo(): ProcessInfo | null {
    return this.processInfo;
  }

  /**
   * 获取缓存的磁盘信息
   * @returns 磁盘信息
   */
  getCachedDiskInfo(): DiskInfo | null {
    return this.diskInfo;
  }

  /**
   * 获取内存使用百分比
   * @returns 内存使用百分比
   */
  getMemoryUsagePercent(): number {
    const info = this.systemInfo || this.getSystemInfo();
    return info.memoryUsagePercent;
  }

  /**
   * 获取CPU负载
   * @returns CPU负载
   */
  getCpuLoad(): number[] {
    const info = this.systemInfo || this.getSystemInfo();
    return info.loadAverage;
  }

  /**
   * 获取系统运行时间
   * @returns 运行时间（秒）
   */
  getSystemUptime(): number {
    const info = this.systemInfo || this.getSystemInfo();
    return info.uptime;
  }

  /**
   * 获取进程运行时间
   * @returns 运行时间（秒）
   */
  getProcessUptime(): number {
    const info = this.processInfo || this.getProcessInfo();
    return info.uptime;
  }
}

/**
 * 全局系统监控实例
 */
let systemMonitor: SystemMonitor | null = null;

/**
 * 获取系统监控实例
 * @param config 配置
 * @returns 系统监控实例
 */
export function getSystemMonitor(
  config?: Partial<SystemMonitorConfig>
): SystemMonitor {
  if (!systemMonitor) {
    systemMonitor = new SystemMonitor(config);
  }
  return systemMonitor;
}

/**
 * 创建系统监控实例
 * @param config 配置
 * @returns 系统监控实例
 */
export function createSystemMonitor(
  config?: Partial<SystemMonitorConfig>
): SystemMonitor {
  return new SystemMonitor(config);
}
