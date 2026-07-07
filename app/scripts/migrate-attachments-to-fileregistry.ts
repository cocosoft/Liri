/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * 迁移脚本：将 attachments_sources 旧数据迁移到 FileRegistry file_files 表
 *
 * 执行方式：
 *   bun run migrate:attachments   （需在 package.json 中添加 script 条目）
 *   # 或直接:
 *   bun run app/scripts/migrate-attachments-to-fileregistry.ts
 *
 * 迁移策略：
 *   - attachments_sources 表保持不变（只读，保留兼容）
 *   - 逐条读取旧记录，计算文件 MD5，注册到 FileRegistry
 *   - 支持断点续传（基于 source 和 source_id 去重）
 */

import { Database } from '../src/core/external/sqlite3';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolveDbPath } from '@modules/core/paths';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { FileRegistry } from '@modules/services/file/FileRegistry';
import { FileSource } from '@modules/services/file/types';

const logger = new Logger({ level: LogLevel.INFO });

export interface MigrationStats {
  total: number;
  skipped: number;
  migrated: number;
  failed: number;
  errors: string[];
}

/**
 * 映射旧的 source 值到 FileSource 枚举
 */
function mapSource(source: string): FileSource {
  switch (source) {
    case 'upload':
      return FileSource.UPLOAD;
    case 'knowledge_auto':
    case 'knowledge':
      return FileSource.AUTO_INGEST;
    case 'telegram':
      return FileSource.TELEGRAM;
    case 'web_fetch':
      return FileSource.WEB_FETCH;
    case 'tool_write':
      return FileSource.TOOL_WRITE;
    default:
      return FileSource.UPLOAD;
  }
}

/**
 * 执行迁移
 */
export async function migrateAttachments(): Promise<MigrationStats> {
  const stats: MigrationStats = {
    total: 0,
    skipped: 0,
    migrated: 0,
    failed: 0,
    errors: [],
  };

  const registry = FileRegistry.getInstance();
  await registry.initDatabase();

  // 使用独立连接读取旧表
  const dbPath = resolveDbPath();
  const oldDb = new Database(dbPath);

  try {
    // 查询所有需要迁移的记录（排除已迁移的）
    const rows: Array<{
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
    }> = await new Promise((resolve, reject) => {
      oldDb.all(
        `SELECT a.* FROM attachments_sources a
         LEFT JOIN file_files f ON f.source_id = a.attachment_id
         WHERE f.id IS NULL
         ORDER BY a.id ASC`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows as any[]);
        }
      );
    });

    stats.total = rows.length;
    logger.info(`找到 ${rows.length} 条待迁移记录`);

    for (const row of rows) {
      try {
        // 检查文件是否存在
        if (!row.file_path || !existsSync(row.file_path)) {
          stats.skipped++;
          continue;
        }

        // 读取文件内容
        const fileContent = await readFile(row.file_path);

        // 注册到 FileRegistry
        await registry.registerFile({
          originalName: row.original_name || `attachment_${row.attachment_id}`,
          content: fileContent,
          source: mapSource(row.source),
          sourceId: row.attachment_id,
          description: row.description || `从 attachments_sources 迁移 (id=${row.id})`,
          mimeType: row.mime_type || 'application/octet-stream',
          storeZone: 'inbound',
        });

        stats.migrated++;
        logger.info(`迁移成功: ${row.file_path} (attachment_id=${row.attachment_id})`);
      } catch (err) {
        stats.failed++;
        const msg = `迁移失败: ${row.file_path || row.attachment_id} - ${(err as Error).message}`;
        stats.errors.push(msg);
        logger.warning(msg);
      }
    }
  } finally {
    oldDb.close();
  }

  logger.info('迁移完成', {
    total: stats.total,
    skipped: stats.skipped,
    migrated: stats.migrated,
    failed: stats.failed,
  });

  return stats;
}

// 直接运行时执行
if (require.main === module) {
  migrateAttachments()
    .then((stats) => {
      console.log(JSON.stringify(stats, null, 2));
      process.exit(stats.failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('迁移失败:', err);
      process.exit(1);
    });
}
