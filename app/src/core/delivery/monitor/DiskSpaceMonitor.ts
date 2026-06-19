import { execSync } from 'node:child_process';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

export interface DiskInfo {
  drive: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usagePercent: number;
}

export interface DiskAlert {
  drive: string;
  usagePercent: number;
  freeBytes: number;
  level: 'warn' | 'critical';
  message: string;
}

export class DiskSpaceMonitor {
  private warnThreshold: number;
  private criticalThreshold: number;
  private trackedDrives: string[];

  constructor(
    warnThreshold: number = 80,
    criticalThreshold: number = 90,
    trackedDrives?: string[]
  ) {
    this.warnThreshold = warnThreshold;
    this.criticalThreshold = criticalThreshold;
    this.trackedDrives = trackedDrives || [];
  }

  check(): DiskInfo[] {
    try {
      const output = execSync(
        'wmic logicaldisk get caption,size,freespace /format:csv',
        { encoding: 'utf-8', timeout: 5000 }
      );

      const lines = output.trim().split('\n').slice(1);
      const disks: DiskInfo[] = [];

      for (const line of lines) {
        const parts = line.split(',').map((s) => s.trim());
        if (parts.length < 3) continue;

        const drive = parts[1];
        const totalBytes = parseInt(parts[2], 10);
        const freeBytes = parseInt(parts[3], 10);

        if (isNaN(totalBytes) || isNaN(freeBytes) || totalBytes === 0) continue;

        const usedBytes = totalBytes - freeBytes;
        const usagePercent = (usedBytes / totalBytes) * 100;

        disks.push({ drive, totalBytes, freeBytes, usedBytes, usagePercent });
      }

      return disks;
    } catch (err) {
      logger.error(
        '磁盘空间检查失败',
        err instanceof Error ? err : new Error(String(err))
      );
      return [];
    }
  }

  checkAndAlert(): DiskAlert[] {
    const disks = this.check();
    const alerts: DiskAlert[] = [];

    for (const disk of disks) {
      if (
        this.trackedDrives.length > 0 &&
        !this.trackedDrives.includes(disk.drive)
      ) {
        continue;
      }

      if (disk.usagePercent >= this.criticalThreshold) {
        alerts.push({
          drive: disk.drive,
          usagePercent: disk.usagePercent,
          freeBytes: disk.freeBytes,
          level: 'critical',
          message: `磁盘 ${disk.drive} 使用率 ${disk.usagePercent.toFixed(1)}%（阈值: ${this.criticalThreshold}%），仅剩 ${formatBytes(disk.freeBytes)} 可用`,
        });
        logger.warn(`磁盘告警 [CRITICAL]: ${disk.drive}`, {
          usagePercent: disk.usagePercent,
          freeBytes: disk.freeBytes,
        });
      } else if (disk.usagePercent >= this.warnThreshold) {
        alerts.push({
          drive: disk.drive,
          usagePercent: disk.usagePercent,
          freeBytes: disk.freeBytes,
          level: 'warn',
          message: `磁盘 ${disk.drive} 使用率 ${disk.usagePercent.toFixed(1)}%（阈值: ${this.warnThreshold}%），剩余 ${formatBytes(disk.freeBytes)}`,
        });
        logger.warn(`磁盘告警 [WARN]: ${disk.drive}`, {
          usagePercent: disk.usagePercent,
          freeBytes: disk.freeBytes,
        });
      }
    }

    return alerts;
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

export const diskSpaceMonitor = new DiskSpaceMonitor();
