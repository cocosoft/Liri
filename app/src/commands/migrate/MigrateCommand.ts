/**
 * Migrate命令
 * 跨版本配置升级和迁移
 *
 * P2-9（2026-09-25）：迁移清单**迁入统一注册表**（`.trae/specs/migration-registry.md` D2）——
 * 本文件不再自持 `getMigrations()` 清单，而是把既有配置迁移**注册**进 `MigrationRegistry`，
 * 并消费其 `runAll()` / `recover()` / `getMigrationStatus()`；新增 `status` / `recover` 子命令。
 */

import type { Command, CommandContext, CommandResult } from '@modules/commands';
import { getLogger } from '@modules/monitoring';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import {
  resolveProjectRoot,
  registerMigration,
  listRegistered,
  runAll,
  recover,
  getMigrationStatus,
} from '@modules/core';
import type { MigrationEntry, MigrationRunReport } from '@modules/core';

const logger = getLogger('MigrateCommand');

/** 单条配置迁移的实现结果（注册表条目的 `apply` 内部使用） */
interface MigrationResult {
  success: boolean;
  message: string;
  warnings: string[];
}

const migrate: Command = {
  type: 'local',
  name: 'migrate',
  description: 'Migrate configuration and data across versions',
  aliases: ['upgrade'],
  loadedFrom: 'builtin',
  disableModelInvocation: true,
  userInvocable: true,

  async load() {
    return {
      async execute(
        args: string,
        _context?: CommandContext
      ): Promise<CommandResult> {
        try {
          // 幂等注册既有配置迁移（模块顶层不做注册副作用）
          registerConfigMigrations();

          const trimmed = args.trim();

          // P2-9：`status` —— 回答"本安装处于哪个版本、哪些迁移待执行"
          if (trimmed === 'status') {
            const entries = await getMigrationStatus();
            const lines = entries.length
              ? entries.map(
                  (e) =>
                    `- ${e.module}: 已应用最高版本=${e.appliedMax ?? '(无)'}；待执行=${
                      e.pending.length > 0 ? e.pending.join(', ') : '无'
                    }`
                )
              : ['(注册表中没有任何迁移)'];
            return {
              success: true,
              type: 'text',
              message: ['📋 迁移状态', ...lines].join('\n'),
              data: entries,
            };
          }

          // P2-9：`recover [--id <id>]` —— 对失败条目恢复快照（无快照时如实报错）
          if (trimmed === 'recover' || trimmed.startsWith('recover ')) {
            const idMatch = trimmed.match(/--id\s+(\S+)/);
            const report = await recover(
              idMatch ? { id: idMatch[1] } : undefined
            );
            return {
              success: report.failedCount === 0,
              type: 'text',
              message: renderRunReport(report, '恢复'),
              data: report,
            };
          }

          const dryRun = trimmed.includes('--dry-run');
          const report = await runAll({ dryRun });
          return {
            success: report.failedCount === 0,
            type: 'text',
            message: renderRunReport(report, dryRun ? '预演' : '迁移'),
            data: report,
          };
        } catch (error) {
          logger.error('迁移失败', error as Error);
          return {
            success: false,
            type: 'error',
            error: `迁移失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    };
  },
};

/** 渲染迁移/恢复报告（对外文案口径保持：一行结论 + 计数 + 逐条明细） */
function renderRunReport(report: MigrationRunReport, verb: string): string {
  const statusLine =
    report.failedCount === 0
      ? `✅ ${verb}成功`
      : `⚠️ ${report.failedCount} 步${verb}失败`;
  const parts = [
    statusLine,
    `应用: ${report.appliedCount}`,
    `跳过: ${report.skippedCount}`,
    `失败: ${report.failedCount}`,
  ];
  if (report.revertedCount > 0) parts.push(`已回滚: ${report.revertedCount}`);
  if (report.plannedCount > 0)
    parts.push(`待执行（预演）: ${report.plannedCount}`);
  const detail = report.steps
    .filter((s) => s.status !== 'skipped')
    .map((s) => `- [${s.status}] ${s.id}${s.error ? ` → ${s.error}` : ''}`);
  return [...parts, ...(detail.length > 0 ? ['', ...detail] : [])].join('\n');
}

/** 既有配置级迁移步骤（原 `getMigrations()` 清单，现改为**注册表条目**，D2 避免双轨） */
function buildConfigMigrations(): MigrationEntry[] {
  const configDir = (): string => join(resolveProjectRoot(), 'config');
  return [
    {
      id: 'config.0.x->1.0',
      module: 'config',
      fromVersion: '0.x',
      toVersion: '1.0',
      description: '初始化 settings.json 配置结构',
      async apply(): Promise<{ warnings?: string[] }> {
        const result = migrateSettingsJson(configDir());
        return { warnings: result.warnings };
      },
    },
    {
      id: 'config.1.0->1.1',
      module: 'config',
      fromVersion: '1.0',
      toVersion: '1.1',
      description: '权限配置从 permission.yaml 迁移到 permissions.yaml',
      async apply(): Promise<{ warnings?: string[] }> {
        const result = migratePermissionFile(configDir());
        return { warnings: result.warnings };
      },
    },
  ];
}

/**
 * 幂等注册既有配置迁移。
 *
 * **同 id 已注册 ⇒ 跳过**（同一实现被多次 `load()` 时不得抛错）；不同实现撞同 id
 * 仍由 `registerMigration()` 抛 `AppError`（fail-closed）。
 */
export function registerConfigMigrations(): void {
  const registered = new Set(listRegistered().map((e) => e.id));
  for (const entry of buildConfigMigrations()) {
    if (!registered.has(entry.id)) registerMigration(entry);
  }
}

/** 0.x → 1.0：settings.json 结构初始化（**迁移逻辑逐字保留**原实现） */
function migrateSettingsJson(dir: string): MigrationResult {
  const warnings: string[] = [];
  const settingsPath = join(dir, '..', 'settings.json');
  if (!existsSync(settingsPath)) {
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          version: '1.0.0',
          migratedAt: new Date().toISOString(),
          features: { securityAudit: true, permissions: true },
        },
        null,
        2
      )
    );
    return { success: true, message: '创建 settings.json', warnings };
  }
  const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  if (!settings['version']) {
    settings['version'] = '1.0.0';
    settings['migratedAt'] = new Date().toISOString();
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return {
      success: true,
      message: 'settings.json 添加版本字段',
      warnings,
    };
  }
  return {
    success: true,
    message: 'settings.json 已是最新版本',
    warnings,
  };
}

/** 1.0 → 1.1：permission.yaml → permissions.yaml（**迁移逻辑逐字保留**原实现） */
function migratePermissionFile(dir: string): MigrationResult {
  const warnings: string[] = [];
  const configsDir = join(dir, '..', 'configs');
  const oldPerm = join(configsDir, 'permission.yaml');
  const newPerm = join(configsDir, 'permissions.yaml');
  if (existsSync(oldPerm) && !existsSync(newPerm)) {
    renameSync(oldPerm, newPerm);
    warnings.push('permission.yaml 已重命名为 permissions.yaml');
    return { success: true, message: '权限配置文件已重命名', warnings };
  }
  return { success: true, message: '权限配置已是最新格式', warnings };
}

export default migrate;
