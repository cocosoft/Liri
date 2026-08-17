/**
 * 资源守护者 —— OfficeCLI 资源风控
 * 每次操作前预检查：内存、磁盘使用量
 * Phase 1 必须包含（方案 §5.1.9）
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { AppError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import { resolvePyappHome } from '@modules/core';

import type { ResourceLimits } from '../types';

const logger = getLogger('doc:execution');

/** 默认资源限制 */
const DEFAULT_LIMITS: ResourceLimits = {
  maxMemoryMB: 300, // OfficeCLI 进程最大 300MB
  maxOutputSizeMB: 50, // 单次输出上限 50MB
  maxDiskUsageMB: 500, // office/output/ 总量上限 500MB
};

/**
 * 资源守护者
 * 与 ExecutionGuardian + DEGRADED 降级形成三件套
 */
export class ResourceGuardian {
  private limits: ResourceLimits;

  constructor(limits?: Partial<ResourceLimits>) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /**
   * 操作前资源预检
   * 失败抛出 AppError，阻止操作执行
   */
  async checkBeforeOperation(operationName: string): Promise<void> {
    // 检查磁盘使用量
    await this.checkDiskUsage();

    // 检查 OfficeCLI 进程内存（仅在进程存在时检查）
    try {
      await this.checkMemoryUsage();
    } catch (err) {
      // 内存检查失败不阻塞（进程可能尚未启动）
      logger.debug('内存检查跳过（进程可能未启动）');
    }
  }

  /**
   * 检查 output 目录磁盘使用量
   */
  private async checkDiskUsage(): Promise<void> {
    const outputDir = path.join(resolvePyappHome(), 'office', 'output');
    if (!fs.existsSync(outputDir)) return;

    const totalSize = this.getDirectorySize(outputDir);
    const totalMB = Math.round(totalSize / 1024 / 1024);

    if (totalMB > this.limits.maxDiskUsageMB) {
      throw new AppError(
        `办公输出目录超限 (${totalMB}MB > ${this.limits.maxDiskUsageMB}MB)，请清理后重试`,
        'EXECUTION' as any,
        'MEDIUM' as any,
        'DOC_DISK_FULL',
        { totalMB, limitMB: this.limits.maxDiskUsageMB }
      );
    }
  }

  /**
   * 检查 OfficeCLI 进程内存使用
   */
  private async checkMemoryUsage(): Promise<void> {
    try {
      // Windows: 通过 tasklist 获取进程内存
      const output = execSync(
        'tasklist /fi "IMAGENAME eq officecli.exe" /fo csv /nh',
        { encoding: 'utf-8', timeout: 3000, windowsHide: true }
      );

      if (!output.trim()) return; // 进程未运行

      // 解析 CSV 输出获取内存（第5列，单位KB）
      const memKB = parseInt(
        output.split(',')[4]?.replace(/"/g, '') || '0',
        10
      );
      const memMB = Math.round(memKB / 1024);

      if (memMB > this.limits.maxMemoryMB) {
        logger.warn('OfficeCLI 内存使用接近上限', {
          memMB,
          limitMB: this.limits.maxMemoryMB,
        });
      }
    } catch (err) {
      // 非关键检查，静默跳过
    }
  }

  /**
   * 递归计算目录大小（字节）
   * G-19：限制递归深度（6 层），防止深目录全量扫描拖慢每次操作前检查
   */
  private getDirectorySize(dirPath: string, depth = 0): number {
    if (depth > 6) return 0;
    let totalSize = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += this.getDirectorySize(fullPath, depth + 1);
      } else {
        totalSize += fs.statSync(fullPath).size;
      }
    }
    return totalSize;
  }

  /**
   * 获取当前资源限制配置
   */
  getLimits(): ResourceLimits {
    return { ...this.limits };
  }
}
