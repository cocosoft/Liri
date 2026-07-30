import { execSync } from 'child_process';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'core:delivery:monitor:diskSpaceMonitor',
  level: LogLevel.INFO,
});

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
      // 使用 PowerShell Get-CimInstance（wmic 已在 Win11 中弃用）
      const output = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk | ForEach-Object { \\"$($_.DeviceID),$($_.Size),$($_.FreeSpace)\\" }"',
        { encoding: 'utf-8', timeout: 5000 }
      );

      const lines = output.trim().split('\n');
      const disks: DiskInfo[] = [];

      for (const line of lines) {
        const parts = line.split(',').map((s) => s.trim().replace(/"/g, ''));
        if (parts.length < 3) continue;

        const drive = parts[0];
        const totalBytes = parseInt(parts[1], 10);
        const freeBytes = parseInt(parts[2], 10);

        if (isNaN(totalBytes) || isNaN(freeBytes) || totalBytes === 0) continue;

        const usedBytes = totalBytes - freeBytes;
        const usagePercent = (usedBytes / totalBytes) * 100;

        disks.push({ drive, totalBytes, freeBytes, usedBytes, usagePercent });
      }

      return disks;
    } catch (err) {
      handleError(err, {
        module: 'core:monitor',
        action: 'check_disk',
      });
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
