/**
 * 更新包下载器
 * 下载 GitHub Release 资源包到本地临时目录
 */

import { getLogger } from '@modules/monitoring';
import { createWriteStream, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const logger = getLogger('cli:updater:updateDownloader');

/**
 * 下载结果
 */
export interface DownloadResult {
  /** 文件路径 */
  filePath: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** 下载耗时（毫秒） */
  durationMs: number;
}

/**
 * 更新包下载器
 */
export class UpdateDownloader {
  private downloadDir: string;
  private requestTimeout: number;

  /**
   * @param downloadDir 下载目录，默认使用系统临时目录
   * @param requestTimeout 下载超时（毫秒）
   */
  constructor(downloadDir?: string, requestTimeout: number = 120000) {
    this.downloadDir = downloadDir || join(tmpdir(), 'pyapp-updates');
    this.requestTimeout = requestTimeout;
  }

  /**
   * 下载更新包
   * @param url 下载 URL
   * @param version 版本号
   * @returns 下载结果
   */
  async download(url: string, version: string): Promise<DownloadResult> {
    mkdirSync(this.downloadDir, { recursive: true });

    const fileName = `pyapp-${version}.zip`;
    const filePath = join(this.downloadDir, fileName);

    logger.info(`开始下载更新包`, { url, filePath });

    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`下载失败: HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      const { writeFile } = await import('fs/promises');
      await writeFile(filePath, buffer);

      const durationMs = Date.now() - startTime;

      logger.info(`更新包下载完成`, {
        filePath,
        size: buffer.length,
        durationMs,
      });

      return {
        filePath,
        fileSize: buffer.length,
        durationMs,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      logger.error(`下载更新包失败`, {
        error: error instanceof Error ? error.message : String(error),
        url,
      });
      throw error;
    }
  }

  /**
   * 获取下载目录路径
   */
  getDownloadDir(): string {
    return this.downloadDir;
  }
}
