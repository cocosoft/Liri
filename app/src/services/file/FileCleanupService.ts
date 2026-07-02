/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * FileCleanupService — 文件过期清理服务
 *
 * 职责：定期清理软删除超过 30 天的文件（物理删除磁盘文件 + DB 记录）
 *
 * 使用方式：
 *   const cleanup = new FileCleanupService();
 *   const result = await cleanup.cleanupExpired({ dryRun: true });
 */

import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { FileRegistry } from './FileRegistry';
import { FILES_TABLE } from './fileSchema';

const logger = new Logger({
  module: 'services:file:cleanup',
  level: LogLevel.INFO,
});

/** 软删除保留天数 */
const SOFT_DELETE_RETENTION_DAYS = 30;

export interface CleanupResult {
  /** 扫描的软删除记录数 */
  scannedCount: number;
  /** 可清理的记录数 */
  cleanupCount: number;
  /** 已清理的记录数 */
  cleanedCount: number;
  /** 清理失败的记录数 */
  failedCount: number;
  /** 清理的文件列表 */
  cleanedFiles: string[];
  /** 错误列表 */
  errors: string[];
}

export interface CleanupOptions {
  /** dryRun 模式：仅报告，不清理 */
  dryRun?: boolean;
  /** 保留天数（默认 30） */
  retentionDays?: number;
}

/**
 * 文件过期清理服务
 */
export class FileCleanupService {
  private registry: FileRegistry;

  constructor() {
    this.registry = FileRegistry.getInstance();
  }

  /**
   * 执行到期清理：删除软删除超过保留天数的文件
   */
  async cleanupExpired(options: CleanupOptions = {}): Promise<CleanupResult> {
    const { dryRun = true, retentionDays = SOFT_DELETE_RETENTION_DAYS } =
      options;
    const cutoffDate = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    const result: CleanupResult = {
      scannedCount: 0,
      cleanupCount: 0,
      cleanedCount: 0,
      failedCount: 0,
      cleanedFiles: [],
      errors: [],
    };

    try {
      await this.registry.initDatabase();

      // 查询软删除超过保留天数的记录
      const rows = await this.registry.query<{
        id: number;
        file_id: string;
        saved_path: string;
        is_deleted: number;
      }>(
        `SELECT id, file_id, saved_path, is_deleted FROM ${FILES_TABLE}
         WHERE is_deleted = 1 AND updated_at < ?`,
        [cutoffDate]
      );

      result.scannedCount = rows.length;
      result.cleanupCount = rows.length;

      for (const row of rows) {
        result.cleanupCount++;

        if (dryRun) {
          result.cleanedFiles.push(row.saved_path);
          continue;
        }

        try {
          // 物理删除磁盘文件
          if (existsSync(row.saved_path)) {
            await unlink(row.saved_path);
          }

          // 从 DB 中彻底删除记录
          await this.registry.query(`DELETE FROM ${FILES_TABLE} WHERE id = ?`, [
            row.id,
          ]);

          result.cleanedCount++;
          result.cleanedFiles.push(row.saved_path);
        } catch (err) {
          result.failedCount++;
          const msg = `清理失败: ${row.saved_path} - ${(err as Error).message}`;
          result.errors.push(msg);
          logger.warning(msg);
        }
      }

      logger.info('过期清理完成', {
        dryRun,
        retentionDays,
        scannedCount: result.scannedCount,
        cleanedCount: result.cleanedCount,
        failedCount: result.failedCount,
      });
    } catch (err) {
      const msg = `过期清理失败: ${(err as Error).message}`;
      result.errors.push(msg);
      await handleError(err, {
        module: 'services:file:cleanup',
        action: 'cleanup_expired',
        context: { retentionDays, dryRun },
      });
    }

    return result;
  }
}
