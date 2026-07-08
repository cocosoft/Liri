/**
 * Migrate命令
 * 跨版本配置升级和迁移
 */

import type { Command, CommandContext, CommandResult } from '@modules/commands';
import { getLogger } from '@modules/monitoring';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
} from 'node:fs';
import { join, dirname } from 'path';
import { resolveProjectRoot } from '@modules/core';

const logger = getLogger('MigrateCommand');

interface MigrationStep {
  fromVersion: string;
  toVersion: string;
  description: string;
  apply: (configDir: string) => MigrationResult;
}

interface MigrationResult {
  success: boolean;
  message: string;
  warnings: string[];
}

interface MigrationReport {
  steps: Array<{
    from: string;
    to: string;
    description: string;
    success: boolean;
    message: string;
    warnings: string[];
  }>;
  totalApplied: number;
  totalFailed: number;
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
        context?: CommandContext
      ): Promise<CommandResult> {
        try {
          const configDir = join(resolveProjectRoot(), 'config');
          const dryRun = args.includes('--dry-run');
          const report = await runMigrations(configDir, dryRun);

          const statusLine =
            report.totalFailed === 0
              ? '✅ 迁移成功'
              : `⚠️ ${report.totalFailed} 步迁移失败`;
          return {
            success: report.totalFailed === 0,
            type: 'text',
            message: `${statusLine}\n应用: ${report.totalApplied}\n失败: ${report.totalFailed}`,
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

async function runMigrations(
  configDir: string,
  dryRun: boolean
): Promise<MigrationReport> {
  const report: MigrationReport = {
    steps: [],
    totalApplied: 0,
    totalFailed: 0,
  };

  const migrations = getMigrations();
  for (const migration of migrations) {
    try {
      const result = migration.apply(configDir);
      report.steps.push({
        from: migration.fromVersion,
        to: migration.toVersion,
        description: migration.description,
        success: result.success,
        message: dryRun ? `[DRY-RUN] ${result.message}` : result.message,
        warnings: result.warnings,
      });
      if (result.success) report.totalApplied++;
      else report.totalFailed++;
    } catch (error) {
      report.steps.push({
        from: migration.fromVersion,
        to: migration.toVersion,
        description: migration.description,
        success: false,
        message: String(error),
        warnings: [],
      });
      report.totalFailed++;
    }
  }

  return report;
}

function getMigrations(): MigrationStep[] {
  return [
    {
      fromVersion: '0.x',
      toVersion: '1.0',
      description: '初始化 settings.json 配置结构',
      apply(dir: string): MigrationResult {
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
      },
    },
    {
      fromVersion: '1.0',
      toVersion: '1.1',
      description: '权限配置从 permission.yaml 迁移到 permissions.yaml',
      apply(dir: string): MigrationResult {
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
      },
    },
  ];
}

export default migrate;
