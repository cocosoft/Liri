/**
 * SystemMetricsCollector.ts — 统一的系统指标采集工具
 *
 * 提供跨平台的 CPU / 内存 / 磁盘采集实现，作为全系统唯一的数据来源。
 * 所有需要显示系统指标的消费者都应通过此模块获取数据。
 */

import os from 'node:os';
import { execSync, exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// ── CPU 计算器（进程级） ──────────────────────────────────────────

/**
 * CPU 差值计算的状态存储
 * 基于 process.cpuUsage 两次采样之间的差值计算实时使用率
 */
const cpuState = {
  prevUsage: null as NodeJS.CpuUsage | null,
  prevTime: 0,
};

/**
 * 获取当前进程 CPU 使用率（0~100）
 *
 * 通过 process.cpuUsage() 两次采样之间的差值除以时间差，
 * 再除以 CPU 核心数，得到当前进程占单核的百分比。
 */
export function getProcessCpuPercent(): number {
  const currentCpu = process.cpuUsage();
  const currentTime = Date.now();

  if (!cpuState.prevUsage || cpuState.prevTime === 0) {
    cpuState.prevUsage = currentCpu;
    cpuState.prevTime = currentTime;
    return 0;
  }

  const userDiff = currentCpu.user - cpuState.prevUsage.user;
  const sysDiff = currentCpu.system - cpuState.prevUsage.system;
  const cpuDiff = userDiff + sysDiff;
  const timeDiff = currentTime - cpuState.prevTime;

  cpuState.prevUsage = currentCpu;
  cpuState.prevTime = currentTime;

  if (timeDiff <= 0 || cpuDiff < 0) return 0;

  const cpuCount = os.cpus().length;
  const percent = (cpuDiff * 100) / (timeDiff * 1000 * cpuCount);
  return Math.min(Math.round(percent * 10) / 10, 100);
}

/**
 * 重置 CPU 状态（用于测试或重新校准）
 */
export function resetCpuState(): void {
  cpuState.prevUsage = null;
  cpuState.prevTime = 0;
}

/**
 * 获取系统级 CPU 使用率（0~100）
 *
 * - Windows: 通过 wmic cpu get loadpercentage 获取整体 CPU 使用率
 * - Unix:   通过 loadavg 1 分钟负载 / 核心数 计算
 *
 * 注意：Windows 的 wmic 可能已被弃用，未来可能需要切换到
 *       Get-CimInstance 或 PowerShell 命令。
 */
export function getSystemCpuPercent(): number {
  if (process.platform === 'win32') {
    try {
      const output = execSync('wmic cpu get loadpercentage /value', {
        encoding: 'utf8',
        timeout: 3000,
      });
      const match = output.match(/LoadPercentage=(\d+)/);
      if (match && match[1]) {
        return Math.min(parseFloat(match[1]), 100);
      }
    } catch {
      // 降级到进程级 CPU
    }
  } else {
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;
    if (cpuCount > 0) {
      const usage = (loadAvg[0] / cpuCount) * 100;
      return Math.min(Math.round(usage * 10) / 10, 100);
    }
  }

  return 0;
}

/**
 * 异步获取系统级 CPU 使用率（0~100）
 *
 * 使用异步 exec 替代 execSync，避免阻塞事件循环。
 */
export async function getSystemCpuPercentAsync(): Promise<number> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync('wmic cpu get loadpercentage /value', {
        timeout: 3000,
      });
      const match = stdout.match(/LoadPercentage=(\d+)/);
      if (match && match[1]) {
        return Math.min(parseFloat(match[1]), 100);
      }
    } catch {
      // 降级到进程级 CPU
    }
  } else {
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;
    if (cpuCount > 0) {
      const usage = (loadAvg[0] / cpuCount) * 100;
      return Math.min(Math.round(usage * 10) / 10, 100);
    }
  }
  return 0;
}

// ── 内存采集 ──────────────────────────────────────────────────────

/**
 * 进程内存指标
 */
export interface ProcessMemory {
  /** 驻留集大小（字节） */
  rss: number;
  /** 堆已用（字节） */
  heapUsed: number;
  /** 堆总量（字节） */
  heapTotal: number;
  /** 外部内存（字节） */
  external: number;
}

/**
 * 系统内存指标
 */
export interface SystemMemory {
  /** 总内存（字节） */
  total: number;
  /** 可用内存（字节） */
  free: number;
  /** 已用内存（字节） */
  used: number;
  /** 使用率百分比（0~100） */
  usagePercent: number;
}

/**
 * 获取进程内存使用情况
 */
export function getProcessMemory(): ProcessMemory {
  const mem = process.memoryUsage();
  return {
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
  };
}

/**
 * 获取系统内存使用情况
 */
export function getSystemMemory(): SystemMemory {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    total,
    free,
    used,
    usagePercent: total > 0 ? Math.round((used / total) * 100) : 0,
  };
}

// ── 磁盘采集 ──────────────────────────────────────────────────────

/**
 * 磁盘指标
 */
export interface DiskInfo {
  /** 总容量（GB） */
  totalGB: number;
  /** 可用空间（GB） */
  freeGB: number;
  /** 已用空间（GB） */
  usedGB: number;
  /** 使用率百分比（0~100） */
  percent: number;
}

/**
 * 收集磁盘信息
 *
 * - Windows: 通过 PowerShell Get-CimInstance 获取磁盘信息（比 wmic 更可靠）
 * - Unix:    通过 df -k
 */
export function getDiskInfo(): DiskInfo {
  let totalBytes = 0;
  let freeBytes = 0;

  try {
    if (process.platform === 'win32') {
      // 使用 PowerShell 替代 wmic，输出 JSON 避免列顺序和编码问题
      const output = execSync(
        'powershell -NoProfile -Command "' +
          'Get-CimInstance Win32_LogicalDisk -Filter \\"DriveType=3\\" | ' +
          'Select-Object Size,FreeSpace | ConvertTo-Json"',
        { encoding: 'utf8', timeout: 5000 }
      );
      const trimmed = output.trim();
      if (trimmed) {
        // ConvertTo-Json 可能返回单个对象或数组
        const parsed = JSON.parse(trimmed);
        const disks = Array.isArray(parsed) ? parsed : [parsed];
        for (const disk of disks) {
          const size = parseFloat(disk.Size);
          const free = parseFloat(disk.FreeSpace);
          if (!isNaN(size) && !isNaN(free) && size > 0) {
            totalBytes += size;
            freeBytes += free;
          }
        }
      }
    } else {
      const output = execSync('df -k --total 2>/dev/null || df -k', {
        encoding: 'utf8',
        timeout: 3000,
      });
      const lines = output.trim().split('\n').slice(1);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4 && parts[0] !== 'total') {
          const total = parseFloat(parts[1]) * 1024;
          const available = parseFloat(parts[3]) * 1024;
          if (!isNaN(total) && !isNaN(available) && total > 0) {
            totalBytes += total;
            freeBytes += available;
          }
        }
      }
    }
  } catch {
    // 磁盘信息不可用时静默处理
  }

  const usedBytes = totalBytes - freeBytes;
  const percent =
    totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
  const gb = 1024 * 1024 * 1024;

  return {
    totalGB: Math.round((totalBytes / gb) * 100) / 100,
    freeGB: Math.round((freeBytes / gb) * 100) / 100,
    usedGB: Math.round((usedBytes / gb) * 100) / 100,
    percent,
  };
}

/**
 * 异步收集磁盘信息
 *
 * 使用异步 exec 替代 execSync，避免阻塞事件循环。
 * - Windows: 通过 PowerShell Get-CimInstance（结构化 JSON 解析，列顺序安全）
 * - Unix:    通过 df -k
 */
export async function getDiskInfoAsync(): Promise<DiskInfo> {
  let totalBytes = 0;
  let freeBytes = 0;

  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        'powershell -NoProfile -Command "' +
          'Get-CimInstance Win32_LogicalDisk -Filter \\"DriveType=3\\" | ' +
          'Select-Object Size,FreeSpace | ConvertTo-Json"',
        { timeout: 5000 }
      );
      const trimmed = stdout.trim();
      if (trimmed) {
        const parsed = JSON.parse(trimmed);
        const disks = Array.isArray(parsed) ? parsed : [parsed];
        for (const disk of disks) {
          const size = parseFloat(disk.Size);
          const free = parseFloat(disk.FreeSpace);
          if (!isNaN(size) && !isNaN(free) && size > 0) {
            totalBytes += size;
            freeBytes += free;
          }
        }
      }
    } else {
      const { stdout } = await execAsync('df -k --total 2>/dev/null || df -k', {
        timeout: 3000,
      });
      const lines = stdout.trim().split('\n').slice(1);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4 && parts[0] !== 'total') {
          const total = parseFloat(parts[1]) * 1024;
          const available = parseFloat(parts[3]) * 1024;
          if (!isNaN(total) && !isNaN(available) && total > 0) {
            totalBytes += total;
            freeBytes += available;
          }
        }
      }
    }
  } catch {
    // 磁盘信息不可用时静默处理
  }

  const usedBytes = totalBytes - freeBytes;
  const percent =
    totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
  const gb = 1024 * 1024 * 1024;

  return {
    totalGB: Math.round((totalBytes / gb) * 100) / 100,
    freeGB: Math.round((freeBytes / gb) * 100) / 100,
    usedGB: Math.round((usedBytes / gb) * 100) / 100,
    percent,
  };
}

// ── 聚合接口 ──────────────────────────────────────────────────────

/**
 * 统一系统指标
 */
export interface SystemMetrics {
  /** 进程级 CPU 使用率（0~100） */
  processCpuPercent: number;
  /** 系统级 CPU 使用率（0~100） */
  systemCpuPercent: number;
  /** 进程内存 */
  processMemory: ProcessMemory;
  /** 系统内存 */
  systemMemory: SystemMemory;
  /** 磁盘信息 */
  disk: DiskInfo;
  /** 系统运行时间（秒） */
  uptime: number;
  /** CPU 核心数 */
  cpuCount: number;
  /** 主机名 */
  hostname: string;
  /** 平台 */
  platform: string;
}

/**
 * 采集所有系统指标
 */
export function collectAllMetrics(): SystemMetrics {
  return {
    processCpuPercent: getProcessCpuPercent(),
    systemCpuPercent: getSystemCpuPercent(),
    processMemory: getProcessMemory(),
    systemMemory: getSystemMemory(),
    disk: getDiskInfo(),
    uptime: process.uptime(),
    cpuCount: os.cpus().length,
    hostname: os.hostname(),
    platform: process.platform,
  };
}
