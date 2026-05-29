/**
 * Backup命令
 * 备份配置、数据、会话到tar.gz压缩包
 */

import type {
  Command,
  CommandContext,
  CommandResult,
} from '@modules/commands/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { resolveProjectRoot, resolveDataDir } from '@modules/config/paths';

const logger = new Logger({ level: LogLevel.INFO });

interface BackupManifest {
  timestamp: string;
  version: string;
  files: string[];
  configs: string[];
  sessions: number;
}

const backup: Command = {
  type: 'local',
  name: 'backup',
  description: 'Backup configs, data, and sessions to a compressed archive',
  aliases: ['snapshot', 'archive'],
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
          const outputDir = args.trim() || join(resolveDataDir(), 'backups');
          const result = await createBackup(outputDir);
          return {
            success: true,
            type: 'text',
            message: `备份完成: ${result.path}\n文件数: ${result.manifest.files.length}\n配置: ${result.manifest.configs.length}\n会话: ${result.manifest.sessions}`,
            data: result,
          };
        } catch (error) {
          logger.error('备份失败', error as Error);
          return {
            success: false,
            type: 'error',
            error: `备份失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    };
  },
};

async function createBackup(
  outputDir: string
): Promise<{ path: string; manifest: BackupManifest }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `pyapp-backup-${timestamp}`;
  const backupDir = join(outputDir, backupName);

  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  const manifest: BackupManifest = {
    timestamp,
    version: '1.0.0',
    files: [],
    configs: [],
    sessions: 0,
  };

  const projectRoot = resolveProjectRoot();

  // 备份配置
  const configDirs = ['config', 'configs'];
  for (const dir of configDirs) {
    const srcDir = join(projectRoot, dir);
    if (existsSync(srcDir)) {
      const destDir = join(backupDir, dir);
      mkdirSync(destDir, { recursive: true });
      copyDirectory(srcDir, destDir, manifest, dir);
    }
  }

  // 备份数据
  const dataDirs = ['data'];
  for (const dir of dataDirs) {
    const srcDir = join(projectRoot, dir);
    if (existsSync(srcDir)) {
      const destDir = join(backupDir, dir);
      mkdirSync(destDir, { recursive: true });
      copyDirectory(srcDir, destDir, manifest, dir);
    }
  }

  // 备份 .env.example
  const envExample = join(projectRoot, '.env.example');
  if (existsSync(envExample)) {
    copyFileSync(envExample, join(backupDir, '.env.example'));
    manifest.configs.push('.env.example');
  }

  // 备份 package.json
  const pkgJson = join(projectRoot, 'package.json');
  if (existsSync(pkgJson)) {
    copyFileSync(pkgJson, join(backupDir, 'package.json'));
    manifest.files.push('package.json');
  }

  // 写入 manifest
  writeFileSync(
    join(backupDir, 'backup-manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // 压缩
  try {
    execSync(
      `tar -czf "${join(outputDir, backupName)}.tar.gz" -C "${outputDir}" "${backupName}"`,
      {
        stdio: 'pipe',
      }
    );
    // 清理临时目录
    execSync(`rmdir /s /q "${backupDir}"`, { stdio: 'pipe', shell: 'cmd.exe' });
  } catch {
    // 压缩/清理失败，保留未压缩的目录
  }

  return {
    path: join(outputDir, `${backupName}.tar.gz`),
    manifest,
  };
}

function copyDirectory(
  src: string,
  dest: string,
  manifest: BackupManifest,
  prefix: string
): void {
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isFile()) {
      copyFileSync(srcPath, destPath);
      manifest.configs.push(join(prefix, entry.name));
    } else if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirectory(srcPath, destPath, manifest, join(prefix, entry.name));
    }
  }
}

export default backup;
