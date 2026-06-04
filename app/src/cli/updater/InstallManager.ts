/**
 * 更新安装管理器
 * 处理更新包的校验、备份和安装
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { join } from 'path';
import { accessSync, constants, copyFileSync, unlinkSync } from 'fs';
import { resolveProjectRoot } from '@modules/core/paths';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 安装结果
 */
export interface InstallResult {
  /** 是否成功 */
  success: boolean;
  /** 备份路径 */
  backupPath?: string;
  /** 错误信息 */
  error?: string;
}

/**
 * 安装管理器
 */
export class InstallManager {
  private backupDir: string;

  /**
   * @param backupDir 备份目录
   */
  constructor(backupDir?: string) {
    this.backupDir = backupDir || join(this.getAppDir(), '.backup');
  }

  /**
   * 校验更新包完整性
   * @param filePath 文件路径
   * @param expectedChecksum 预期的校验和
   * @returns 是否通过校验
   */
  async verify(filePath: string, expectedChecksum?: string): Promise<boolean> {
    if (!expectedChecksum) {
      logger.info('无校验和，跳过完整性校验');
      return true;
    }

    try {
      const { createHash } = await import('crypto');
      const { readFile } = await import('fs/promises');

      const fileBuffer = await readFile(filePath);
      const actualChecksum = createHash('sha256')
        .update(fileBuffer)
        .digest('hex');

      const isValid =
        actualChecksum.toLowerCase() === expectedChecksum.toLowerCase();

      if (!isValid) {
        logger.error('校验和不匹配', {
          error: 'Checksum mismatch',
          expected: expectedChecksum,
          actual: actualChecksum,
        });
      }

      return isValid;
    } catch (error) {
      logger.error('校验失败', {
        error: error instanceof Error ? error.message : String(error),
        filePath,
      });
      return false;
    }
  }

  /**
   * 备份当前版本
   * @returns 备份路径
   */
  async backup(): Promise<string> {
    const appDir = this.getAppDir();

    try {
      accessSync(appDir, constants.R_OK);
    } catch {
      logger.warning('应用目录不可读，跳过备份');
      return '';
    }

    const { mkdir } = await import('fs/promises');
    await mkdir(this.backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(this.backupDir, `backup-${timestamp}`);

    const { cp } = await import('fs/promises');
    await cp(appDir, backupPath, { recursive: true });

    logger.info(`当前版本已备份`, { backupPath });

    return backupPath;
  }

  /**
   * 执行安装
   * @param filePath 更新包路径
   * @returns 安装结果
   */
  async install(filePath: string): Promise<InstallResult> {
    try {
      logger.info(`开始安装更新包`, { filePath });

      let backupPath = '';
      try {
        backupPath = await this.backup();
      } catch (backupError) {
        logger.warning(`备份失败，继续执行安装`, { error: backupError });
      }

      const appDir = this.getAppDir();
      const { mkdir, readdir, rename } = await import('fs/promises');
      const extractDir = join(appDir, '.update-extract');

      await mkdir(extractDir, { recursive: true });

      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);

      await execFileAsync('unzip', ['-o', filePath, '-d', extractDir]);

      const files = await readdir(extractDir);
      for (const file of files) {
        const srcPath = join(extractDir, file);
        const destPath = join(appDir, file);
        try {
          await rename(srcPath, destPath);
        } catch {
          logger.warning(`移动文件失败: ${file}，尝试复制`);
          const { cp } = await import('fs/promises');
          await cp(srcPath, destPath, { recursive: true, force: true });
        }
      }

      await this.cleanup();

      logger.info(`安装完成`);

      return {
        success: true,
        backupPath,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`安装失败`, error as Error);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * 清理临时文件
   */
  async cleanup(): Promise<void> {
    const appDir = this.getAppDir();
    const extractDir = join(appDir, '.update-extract');

    try {
      const { rm } = await import('fs/promises');
      await rm(extractDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }

  /**
   * 获取应用目录
   */
  private getAppDir(): string {
    return resolveProjectRoot();
  }
}
