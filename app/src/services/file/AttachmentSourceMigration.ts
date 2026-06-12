/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * AttachmentSourceMigration — attachments_sources 表数据迁移到 file_files 表
 *
 * 迁移策略：
 *   1. 读取 attachments_sources 中所有记录
 *   2. 对每条记录，尝试从 file_path 读取文件内容
 *   3. 计算 MD5，生成统一命名，注册到 FileRegistry
 *   4. 文件已存在则跳过（基于 MD5 去重）
 *   5. 记录迁移统计信息（成功/跳过/失败数）
 *
 * 使用方式：
 *   const migration = new AttachmentSourceMigration(dbPath);
 *   const result = await migration.run();
 *   console.log(result.summary);
 */

import { Database } from 'sqlite3';
import { existsSync, readFileSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/** attachments_sources 记录 */
interface AttachmentSourceRow {
  id: number;
  attachment_id: string;
  source: string;
  source_id: string | null;
  description: string | null;
  original_name: string | null;
  file_path: string | null;
  mime_type: string | null;
  file_size: number | null;
  created_at: number;
}

export interface MigrationResult {
  /** 迁移总数 */
  total: number;
  /** 成功迁移数 */
  migrated: number;
  /** 跳过数（文件不存在或已注册） */
  skipped: number;
  /** 失败数 */
  failed: number;
  /** 汇总信息 */
  summary: string;
  /** 失败详情 */
  failures: Array<{ id: number; attachmentId: string; reason: string }>;
}

/**
 * attachments_sources → file_files 数据迁移器
 */
export class AttachmentSourceMigration {
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /**
   * 执行迁移
   *
   * @param dryRun 是否为试运行（不实际写入）
   * @returns 迁移结果
   */
  async run(dryRun = false): Promise<MigrationResult> {
    const result: MigrationResult = {
      total: 0,
      migrated: 0,
      skipped: 0,
      failed: 0,
      summary: '',
      failures: [],
    };

    const { FileRegistry } = await import('@modules/services/file/FileRegistry');

    // 检查附件记录表是否存在
    const db = new Database(this.dbPath);
    const tableExists = await this.tableExists(db, 'attachments_sources');

    if (!tableExists) {
      result.summary = 'attachments_sources 表不存在，无需迁移';
      logger.info(result.summary);
      db.close();
      return result;
    }

    // 读取所有附件记录
    const rows = await this.queryAll(db, 'SELECT * FROM attachments_sources ORDER BY id ASC') as AttachmentSourceRow[];

    result.total = rows.length;
    logger.info(`找到 ${rows.length} 条附件记录待迁移`);

    if (rows.length === 0) {
      result.summary = 'attachments_sources 表中无记录，无需迁移';
      db.close();
      return result;
    }

    const registry = FileRegistry.getInstance();
    await registry.initDatabase();

    for (const row of rows) {
      try {
        // 文件路径为空或文件不存在 → 跳过
        if (!row.file_path || !existsSync(row.file_path)) {
          result.skipped++;
          logger.debug('文件不存在，跳过', {
            attachmentId: row.attachment_id,
            filePath: row.file_path,
          });
          continue;
        }

        // 读取文件内容
        const content = readFileSync(row.file_path);

        if (dryRun) {
          result.migrated++;
          continue;
        }

        // 注册到 FileRegistry（内置 MD5 去重）
        await registry.registerFile({
          originalName: row.original_name || 'unknown',
          content,
          source: row.source,
          sourceId: row.source_id || row.attachment_id,
          mimeType: row.mime_type || 'application/octet-stream',
          description: row.description || `从 attachments_sources 迁移 (id=${row.id})`,
          storeZone: 'inbound',
        });

        result.migrated++;
        logger.debug('附件迁移成功', {
          attachmentId: row.attachment_id,
          source: row.source,
        });
      } catch (error) {
        result.failed++;
        result.failures.push({
          id: row.id,
          attachmentId: row.attachment_id,
          reason: (error as Error).message,
        });
        logger.warn('附件迁移失败', {
          attachmentId: row.attachment_id,
          error: String(error),
        });
      }
    }

    db.close();

    result.summary = `迁移完成: 总计 ${result.total} 条, 成功 ${result.migrated}, 跳过 ${result.skipped}, 失败 ${result.failed}`;
    logger.info(result.summary);

    return result;
  }

  /**
   * 检查表是否存在
   */
  private tableExists(db: Database, tableName: string): Promise<boolean> {
    return new Promise((resolve) => {
      db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        [tableName],
        (err, row) => {
          resolve(!err && row !== undefined);
        }
      );
    });
  }

  /**
   * 执行查询并返回所有行
   */
  private queryAll(db: Database, sql: string, params: unknown[] = []): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }
}