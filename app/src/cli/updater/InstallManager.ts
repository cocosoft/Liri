/**
 * 更新安装管理器
 * 处理更新包的校验、备份和安装
 */

import { getLogger } from '@modules/monitoring';
import { join } from 'path';
import { accessSync, constants, copyFileSync, unlinkSync } from 'fs';
import { resolveProjectRoot } from '@modules/core';

const logger = getLogger('cli:updater:installManager');

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
    } catch (err) {
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
      const { mkdir, readdir, rename, rm, lstat, copyFile } =
        await import('fs/promises');
      const { dirname } = await import('path');
      const extractDir = join(appDir, '.update-extract');

      await mkdir(extractDir, { recursive: true });

      // 跨平台解压：不依赖系统 unzip（原 execFile('unzip') 在 Windows 必然 ENOENT）
      const { default: AdmZip } = await import('adm-zip');
      new AdmZip(filePath).extractAllTo(extractDir, true);

      // 目录递归合并：覆盖同名文件，保留目标目录中不被更新包包含的文件（与 pkg 布局 node_modules/ 对齐）
      const mergeDir = async (from: string, to: string): Promise<void> => {
        await mkdir(to, { recursive: true });
        const children = await readdir(from);
        for (const child of children) {
          const cSrc = join(from, child);
          const cDest = join(to, child);
          if ((await lstat(cSrc)).isDirectory()) {
            await mergeDir(cSrc, cDest);
          } else {
            await mkdir(dirname(cDest), { recursive: true });
            await copyFile(cSrc, cDest);
          }
        }
      };

      const applyEntry = async (name: string): Promise<void> => {
        const src = join(extractDir, name);
        const dest = join(appDir, name);
        const st = await lstat(src);
        if (st.isDirectory()) {
          await mergeDir(src, dest);
          await rm(src, { recursive: true, force: true });
        } else {
          await mkdir(dirname(dest), { recursive: true });
          try {
            await rename(src, dest);
          } catch {
            // Windows 目标已存在时 rename 抛错 → 复制覆盖
            await copyFile(src, dest);
            await rm(src, { force: true });
          }
        }
      };

      const files = await readdir(extractDir);
      for (const file of files) {
        try {
          await applyEntry(file);
        } catch (err) {
          logger.error(`更新应用失败: ${file}`, err as Error);
          // 失败回滚（best-effort）：仅当存在备份时移除已落盘条目并从备份恢复，避免新旧混合/数据丢失
          try {
            if (backupPath) {
              for (const applied of files) {
                await rm(join(appDir, applied), {
                  recursive: true,
                  force: true,
                });
              }
              const backupEntries = await readdir(backupPath);
              for (const entry of backupEntries) {
                const bSrc = join(backupPath, entry);
                const bDest = join(appDir, entry);
                if ((await lstat(bSrc)).isDirectory()) {
                  await mergeDir(bSrc, bDest);
                } else {
                  await copyFile(bSrc, bDest);
                }
              }
              logger.info('已从备份回滚更新');
            } else {
              logger.warning('无备份可回滚，保留已应用文件以避免进一步破坏');
            }
          } catch (rollbackErr) {
            logger.warning(
              `回滚失败，请手动从备份恢复: ${backupPath || '无备份'}`,
              {
                error: String(rollbackErr),
              }
            );
          }
          throw err;
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
    } catch (err) {
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
