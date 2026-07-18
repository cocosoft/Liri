/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * FileGCService — Orphan 文件 GC 扫描服务
 *
 * 职责：扫描 ~/.pyapp/knowledge/raw/inbound/ 目录下的文件，
 *       查找 DB 中无对应记录的文件（orphan），清理或报告。
 *
 * 使用方式：
 *   const gc = new FileGCService();
 *   const result = await gc.scanAndClean({ dryRun: true });
 */

import { readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { resolveInboundBaseDir } from '@modules/core';
import { FileRegistry } from './FileRegistry';
import { FILES_TABLE } from './fileSchema';

const logger = new Logger({ module: 'services:file:gc', level: LogLevel.INFO });

export interface GCResult {
  /** 扫描的文件总数 */
  scannedCount: number;
  /** 发现的 Orphan 文件数 */
  orphanCount: number;
  /** 已清理的 Orphan 文件数 */
  cleanedCount: number;
  /** Orphan 文件列表 */
  orphans: string[];
  /** 错误列表 */
  errors: string[];
}

export interface GCOptions {
  /** dryRun 模式：仅报告，不清理 */
  dryRun?: boolean;
  /** 是否自动清理 Orphan 文件 */
  autoClean?: boolean;
  /** 最大扫描深度（默认 5） */
  maxDepth?: number;
}

/**
 * Orphan 文件 GC 扫描服务
 */
export class FileGCService {
  private registry: FileRegistry;

  constructor() {
    this.registry = FileRegistry.getInstance();
  }

  /**
   * 执行 GC 扫描
   * 扫描 inbound 目录下的所有文件，检查 DB 中是否有对应记录
   */
  async scanAndClean(options: GCOptions = {}): Promise<GCResult> {
    const { dryRun = true, autoClean = false, maxDepth = 5 } = options;

    const result: GCResult = {
      scannedCount: 0,
      orphanCount: 0,
      cleanedCount: 0,
      orphans: [],
      errors: [],
    };

    try {
      await this.registry.initDatabase();
      const baseDir = resolveInboundBaseDir();

      if (!existsSync(baseDir)) {
        logger.info('Inbound 目录不存在，跳过 GC', { baseDir });
        return result;
      }

      // 收集所有文件路径
      const allFiles = await this.collectFiles(baseDir, 0, maxDepth);

      // 批量查询 DB 中存在的 saved_path
      const savedPaths = await this.queryExistingPaths(allFiles);

      // 找出 Orphan 文件
      for (const filePath of allFiles) {
        result.scannedCount++;
        if (!savedPaths.has(filePath)) {
          result.orphanCount++;
          result.orphans.push(filePath);

          if (autoClean && !dryRun) {
            try {
              await unlink(filePath);
              result.cleanedCount++;
            } catch (err) {
              const msg = `清理失败: ${filePath} - ${(err as Error).message}`;
              result.errors.push(msg);
              logger.warning(msg);
            }
          }
        }
      }

      logger.info('GC 扫描完成', {
        dryRun,
        scannedCount: result.scannedCount,
        orphanCount: result.orphanCount,
        cleanedCount: result.cleanedCount,
      });
    } catch (err) {
      const msg = `GC 扫描失败: ${(err as Error).message}`;
      result.errors.push(msg);
      await handleError(err, {
        module: 'services:file:gc',
        action: 'scan_and_clean',
      });
    }

    return result;
  }

  /**
   * 递归收集目录下所有文件
   */
  private async collectFiles(
    dirPath: string,
    depth: number,
    maxDepth: number
  ): Promise<string[]> {
    const files: string[] = [];
    if (depth > maxDepth) return files;

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          const subFiles = await this.collectFiles(
            fullPath,
            depth + 1,
            maxDepth
          );
          files.push(...subFiles);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    } catch (err) {
      // 跳过无法读取的目录
    }

    return files;
  }

  /**
   * 批量查询 DB 中存在的 saved_path 集合
   */
  private async queryExistingPaths(filePaths: string[]): Promise<Set<string>> {
    const existing = new Set<string>();
    if (filePaths.length === 0) return existing;

    // 分批查询，避免 SQL 过长
    const batchSize = 100;
    for (let i = 0; i < filePaths.length; i += batchSize) {
      const batch = filePaths.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(', ');

      try {
        const rows = await this.registry.query<{ saved_path: string }>(
          `SELECT saved_path FROM ${FILES_TABLE} WHERE saved_path IN (${placeholders})`,
          batch
        );
        for (const row of rows) {
          existing.add(row.saved_path);
        }
      } catch (err) {
        // 跳过查询失败的批次
      }
    }

    return existing;
  }
}
