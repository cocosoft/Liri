/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * 渠道凭据存量明文加密迁移脚本（P0-4 / 4.4）
 *
 * 将 channel_configs 表中已存在但未加密的敏感字段（token/secret/password 等）
 * 加密落库（AES-256-GCM，与 ChannelSecretStore 同一密钥）。
 *
 * 用法：
 *   bun run app/scripts/migrate-channel-credentials.ts                # dry-run 预览（默认）
 *   bun run app/scripts/migrate-channel-credentials.ts --apply        # 实际迁移（迁移前自动备份）
 *   bun run app/scripts/migrate-channel-credentials.ts --rollback <备份文件>  # 从备份回滚
 *
 * 安全：任何模式都不会删除/降级数据；--apply 前先写备份；解密/加密失败即中止。
 */

// 提前设置环境变量，避免模块初始化时的循环依赖（与 migrate-memory 脚本一致）
const { homedir } = await import('os');
const pyappHome = homedir() + '/.pyapp';
process.env.PYAPP_HOME = pyappHome;
process.env.PYAPP_DATA_DIR = pyappHome + '/data';
process.env.PYAPP_PROJECT_DIR = process.cwd();

import { Database } from 'bun:sqlite';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolveDbPath, resolveDataSubDir } from '@modules/core';
import { isSensitiveKey, encryptSecret } from '../src/channels/secrets/encryption';

interface Row {
  id: string;
  name: string;
  type: string;
  enabled: number;
  options: string;
}

interface BackupFile {
  createdAt: string;
  dbPath: string;
  rows: Array<{ id: string; name: string; type: string; options: string }>;
}

function log(msg: string): void {
  console.log(`[migrate-channel-credentials] ${msg}`);
}

/** 解析 options JSON，加密敏感字段；返回 { newOptionsJson, changedFields } */
function encryptRowOptions(raw: string): {
  next: string;
  changed: Array<{ key: string; fromLen: number; toPrefix: string }>;
} {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    return { next: raw, changed: [] }; // 非法 JSON 跳过（保留原样）
  }

  const changed: Array<{ key: string; fromLen: number; toPrefix: string }> = [];
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (
      typeof value === 'string' &&
      value.length > 0 &&
      isSensitiveKey(key) &&
      !value.startsWith('enc:')
    ) {
      const encrypted = encryptSecret(value);
      next[key] = encrypted;
      changed.push({ key, fromLen: value.length, toPrefix: 'enc:' });
    } else {
      next[key] = value;
    }
  }

  return { next: JSON.stringify(next), changed };
}

/** 读取备份文件内容 */
function readBackup(file: string): BackupFile {
  return JSON.parse(readFileSync(file, 'utf-8')) as BackupFile;
}

function usage(): void {
  log('用法:');
  log('  bun run app/scripts/migrate-channel-credentials.ts');
  log('  bun run app/scripts/migrate-channel-credentials.ts --apply');
  log('  bun run app/scripts/migrate-channel-credentials.ts --rollback <备份文件>');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const rollbackIdx = args.indexOf('--rollback');

  if (rollbackIdx >= 0) {
    const backupPath = args[rollbackIdx + 1];
    if (!backupPath) {
      usage();
      process.exit(1);
    }
    await doRollback(backupPath);
    return;
  }

  const dbPath = resolveDbPath();
  if (!existsSync(dbPath)) {
    log(`数据库不存在: ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: dryRun });
  try {
    const rows = db
      .query('SELECT id, name, type, enabled, options FROM channel_configs')
      .all() as unknown as Row[];
    log(`共 ${rows.length} 条渠道配置`);

    const changedRows: Array<Row & { changed: Row['options'] }> = [];
    let changedFields = 0;

    for (const row of rows) {
      const { next, changed } = encryptRowOptions(row.options);
      changedFields += changed.length;
      if (changed.length > 0) {
        changedRows.push({ ...row, changed: next });
        log(
          `  [待加密] ${row.type || row.name}: ${changed
            .map((c) => `${c.key}(明文${c.fromLen}字符)`)
            .join(', ')}`
        );
      }
    }

    log(`敏感字段变更: ${changedFields} 个（涉及 ${changedRows.length} 条渠道）`);

    if (changedRows.length === 0) {
      log('无需迁移（所有敏感字段均已加密或为空）。');
      process.exit(0);
    }

    if (dryRun) {
      log('DRY-RUN：以上为预览，未修改数据库。确认后使用 --apply 执行。');
      process.exit(0);
    }

    // ── 实际迁移：先备份 ──
    const backupDir = resolveDataSubDir('channels');
    mkdirSync(backupDir, { recursive: true });
    const backupPath = join(
      backupDir,
      `migration-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    );
    const backup: BackupFile = {
      createdAt: new Date().toISOString(),
      dbPath,
      rows: rows.map(({ id, name, type, options }) => ({ id, name, type, options })),
    };
    writeFileSync(backupPath, JSON.stringify(backup, null, 2), {
      mode: 0o600,
    });
    log(`已备份原始配置: ${backupPath}`);

    // 写回加密后的 options
    const updateStmt = db.prepare(
      'UPDATE channel_configs SET options = ? WHERE id = ?'
    );
    const tx = db.transaction((items: Array<Row & { changed: string }>) => {
      for (const item of items) {
        updateStmt.run(item.changed, item.id);
      }
    });
    tx(changedRows);
    log(`已加密写回 ${changedRows.length} 条渠道配置。`);
    log(`回滚命令: bun run app/scripts/migrate-channel-credentials.ts --rollback ${backupPath}`);
  } finally {
    db.close();
  }
}

async function doRollback(backupPath: string): Promise<void> {
  if (!existsSync(backupPath)) {
    log(`备份文件不存在: ${backupPath}`);
    process.exit(1);
  }
  const backup = readBackup(backupPath);
  if (!backup.dbPath || !existsSync(backup.dbPath)) {
    log(`备份中的数据库不存在: ${backup?.dbPath}`);
    process.exit(1);
  }

  const db = new Database(backup.dbPath);
  try {
    const updateStmt = db.prepare(
      'UPDATE channel_configs SET options = ? WHERE id = ?'
    );
    const tx = db.transaction(
      (rows: Array<{ id: string; options: string }>) => {
        let restored = 0;
        for (const row of rows) {
          const res = updateStmt.run(row.options, row.id);
          if (res.changes > 0) restored++;
        }
        return restored;
      }
    );
    const restored = tx(backup.rows);
    log(`已从 ${backupPath} 恢复 ${restored}/${backup.rows.length} 条渠道配置。`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  log(`迁移脚本异常: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
