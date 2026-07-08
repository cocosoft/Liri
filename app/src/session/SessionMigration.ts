/**
 * 会话存储迁移管理器
 * 支持跨版本会话数据结构升级
 * 对齐 OpenClaw config/sessions/store-migrations.ts
 */

import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'path';
import { resolveDataDir, resolveSessionsDir } from '@modules/core';

const logger = new Logger({
  module: 'session:migration',
  level: LogLevel.INFO,
});

export interface MigrationVersion {
  from: string;
  to: string;
  apply: (data: Record<string, unknown>) => Record<string, unknown>;
  description: string;
}

export interface MigrationResult {
  from: string;
  to: string;
  description: string;
  success: boolean;
  errors: string[];
}

export class SessionMigration {
  private migrations: MigrationVersion[] = [];
  private stateDir: string;

  constructor(stateDir?: string) {
    this.stateDir =
      stateDir || join(resolveDataDir(), 'sessions', '.migration');
  }

  registerMigration(migration: MigrationVersion): void {
    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.from.localeCompare(b.from));
  }

  async migrate(): Promise<MigrationResult[]> {
    const otel = getOTelTracing();
    const span = otel.startSpan('SessionMigration.migrate');

    try {
      const results: MigrationResult[] = [];

      try {
        const sessionFiles = this.getSessionFiles();
        logger.info(`发现 ${sessionFiles.length} 个会话文件待迁移`);

        for (const sessionFile of sessionFiles) {
          for (const migration of this.migrations) {
            const result = await this.migrateFile(sessionFile, migration);
            results.push(result);
          }
        }
      } catch (error) {
        logger.error('会话迁移失败', error as Error);
      }

      otel.endSpan(span);
      return results;
    } catch (e) {
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR);
      await handleError(e, {
        module: 'session:migration',
        action: 'migrate',
        rethrow: false,
      });
      return [];
    }
  }

  private async migrateFile(
    filePath: string,
    migration: MigrationVersion
  ): Promise<MigrationResult> {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);

      // 检查是否需要迁移
      const currentVersion = data['version'] || '0.0.0';
      if (currentVersion !== migration.from) {
        return {
          from: migration.from,
          to: migration.to,
          description: migration.description,
          success: true,
          errors: [],
        };
      }

      // 备份原文件
      const backup = `${filePath}.${Date.now()}.bak`;
      writeFileSync(backup, raw);

      // 应用迁移
      const migrated = migration.apply(data);
      migrated['version'] = migration.to;
      migrated['migratedAt'] = new Date().toISOString();

      writeFileSync(filePath, JSON.stringify(migrated, null, 2));

      logger.info(
        `会话迁移: ${filePath} (${migration.from} → ${migration.to})`
      );

      return {
        from: migration.from,
        to: migration.to,
        description: migration.description,
        success: true,
        errors: [],
      };
    } catch (error) {
      return {
        from: migration.from,
        to: migration.to,
        description: migration.description,
        success: false,
        errors: [String(error)],
      };
    }
  }

  private getSessionFiles(): string[] {
    const results: string[] = [];
    const dirs = [resolveSessionsDir(), resolveDataDir()];

    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      try {
        const { readdirSync } = require('node:fs');
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (
            entry.isFile() &&
            (entry.name.endsWith('.json') || entry.name.endsWith('.jsonl'))
          ) {
            results.push(join(dir, entry.name));
          }
        }
      } catch {
        // 目录读取失败
      }
    }

    return results;
  }
}

/**
 * 默认迁移链
 */
export const DEFAULT_MIGRATIONS: MigrationVersion[] = [
  {
    from: '0.0.0',
    to: '1.0.0',
    description: '初始化会话版本字段',
    apply(data: Record<string, unknown>): Record<string, unknown> {
      if (!data['messages']) data['messages'] = [];
      if (!data['createdAt']) data['createdAt'] = new Date().toISOString();
      return data;
    },
  },
  {
    from: '1.0.0',
    to: '1.1.0',
    description: '添加消息 ID 字段',
    apply(data: Record<string, unknown>): Record<string, unknown> {
      const messages =
        (data['messages'] as Array<Record<string, unknown>>) || [];
      for (let i = 0; i < messages.length; i++) {
        if (!messages[i]['id']) {
          messages[i]['id'] = `migrated-${i}-${Date.now()}`;
        }
      }
      return data;
    },
  },
];
