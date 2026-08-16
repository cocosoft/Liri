/**
 * 会话存储迁移管理器
 * 支持跨版本会话数据结构升级
 * 对齐 OpenClaw config/sessions/store-migrations.ts
 */

import { getLogger, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { resolveDataDir, resolveSessionsDir } from '@modules/core';
import { AtomicWriter } from './persistence/AtomicWriter';

const logger = getLogger('session:migration');

/** 版本号数值比较（P2-30 修复：localeCompare 字典序在两位数版本下错乱） */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 会话文件形状校验（P2-30 修复）：非对象 / 数组 / 无会话特征字段的数据不迁移 */
function looksLikeSession(data: unknown): boolean {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false;
  }
  const d = data as Record<string, unknown>;
  return (
    typeof d['id'] === 'string' ||
    typeof d['title'] === 'string' ||
    Array.isArray(d['messages']) ||
    typeof d['version'] === 'string'
  );
}

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
    this.migrations.sort((a, b) => compareVersions(a.from, b.from));
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
        handleError(error, {
          module: 'sessions:migration',
          action: '会话迁移失败',
        });
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

      // P2-30 修复：schema 校验——非会话文件（fts-index.json 等）跳过，不产生失败噪音
      if (!looksLikeSession(data)) {
        logger.debug('跳过非会话文件', { filePath });
        return {
          from: migration.from,
          to: migration.to,
          description: migration.description,
          success: true,
          errors: [],
        };
      }

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

      // 应用迁移
      const migrated = migration.apply(data);
      // P2-30 修复：apply 返回垃圾（非对象）时拒绝写盘
      if (
        typeof migrated !== 'object' ||
        migrated === null ||
        Array.isArray(migrated)
      ) {
        throw new Error(
          `迁移 ${migration.from} → ${migration.to} 返回了非法数据`
        );
      }
      migrated['version'] = migration.to;
      migrated['migratedAt'] = new Date().toISOString();

      // P2-30 修复：备份 + 写回改为原子写（tmp + rename），崩溃不会留下半个文件
      const writer = new AtomicWriter();
      const backup = `${filePath}.${Date.now()}.bak`;
      await writer.write(backup, raw);
      await writer.writeJSON(filePath, migrated);
      // 迁移成功且数据已校验，清理备份避免 .bak 持续积累
      unlinkSync(backup);

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

    // P2-30 修复：递归扫描子目录（会话按 {sessions}/{sessionId}/session.json 组织），
    // 只收 .json 文件，排除 messages.jsonl（追加写消息文件，JSONL 非 JSON 会话文件）；
    // 跳过 .corrupt/.migration 等隐藏目录
    const scanDir = (dir: string): void => {
      if (!existsSync(dir)) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.')) continue;
          scanDir(full);
        } else if (
          entry.name.endsWith('.json') &&
          entry.name !== 'messages.jsonl'
        ) {
          results.push(full);
        }
      }
    };

    for (const dir of dirs) scanDir(dir);

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
