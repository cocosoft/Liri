/**
 * MediaStore 媒体存储管理
 * 对标 CC 的媒体存储管理能力
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolvePyappHome } from '@modules/config/paths';

/**
 * 存储配置
 */
export interface MediaStoreConfig {
  basePath: string;
  maxSize: number;
  organizeByDate: boolean;
}

/**
 * 文件信息
 */
export interface MediaFileInfo {
  path: string;
  size: number;
  mimeType: string;
  createdAt: number;
  checksum?: string;
}

/**
 * 媒体存储管理器
 */
export class MediaStore {
  private config: MediaStoreConfig;

  constructor(config?: Partial<MediaStoreConfig>) {
    this.config = {
      basePath: config?.basePath || path.join(resolvePyappHome(), 'media'),
      maxSize: config?.maxSize || 1024 * 1024 * 1024,
      organizeByDate: config?.organizeByDate !== false,
    };

    fs.mkdirSync(this.config.basePath, { recursive: true });
  }

  /**
   * 获取存储路径
   */
  getPath(category: string, fileName: string): string {
    let dir = this.config.basePath;

    if (this.config.organizeByDate) {
      const now = new Date();
      dir = path.join(
        dir,
        `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
      );
    }

    dir = path.join(dir, category);
    fs.mkdirSync(dir, { recursive: true });

    return path.join(dir, fileName);
  }

  /**
   * 保存文件
   */
  save(
    category: string,
    fileName: string,
    data: Buffer | string
  ): string | null {
    try {
      const filePath = this.getPath(category, fileName);
      fs.writeFileSync(filePath, data);

      return filePath;
    } catch {
      return null;
    }
  }

  /**
   * 复制文件到存储
   */
  copy(sourcePath: string, category: string, fileName?: string): string | null {
    try {
      const targetName = fileName || path.basename(sourcePath);
      const targetPath = this.getPath(category, targetName);

      fs.copyFileSync(sourcePath, targetPath);

      return targetPath;
    } catch {
      return null;
    }
  }

  /**
   * 删除文件
   */
  delete(filePath: string): boolean {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);

        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * 获取文件信息
   */
  getInfo(filePath: string): MediaFileInfo | null {
    try {
      if (!fs.existsSync(filePath)) return null;

      const stat = fs.statSync(filePath);

      return {
        path: filePath,
        size: stat.size,
        mimeType: this.guessMimeType(filePath),
        createdAt: stat.birthtimeMs,
      };
    } catch {
      return null;
    }
  }

  /**
   * 获取存储统计
   */
  getStats(): {
    totalFiles: number;
    totalSize: number;
    categories: Record<string, { count: number; size: number }>;
  } {
    const stats: MediaStore['getStats'] extends (...args: unknown[]) => infer R
      ? R
      : never = {
      totalFiles: 0,
      totalSize: 0,
      categories: {},
    };

    try {
      this.walkDir(this.config.basePath, stats as any);
    } catch {}

    return stats as any;
  }

  /**
   * 清理空目录
   */
  cleanupEmptyDirs(): number {
    let cleaned = 0;

    try {
      cleaned = this.removeEmptyDirs(this.config.basePath);
    } catch {}

    return cleaned;
  }

  /**
   * 获取存储路径
   */
  getBasePath(): string {
    return this.config.basePath;
  }

  /**
   * 递归遍历目录
   */
  private walkDir(
    dir: string,
    stats: {
      totalFiles: number;
      totalSize: number;
      categories: Record<string, { count: number; size: number }>;
    }
  ): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        this.walkDir(fullPath, stats);
      } else if (entry.isFile()) {
        const size = fs.statSync(fullPath).size;
        const category = path.basename(path.dirname(fullPath));

        stats.totalFiles++;
        stats.totalSize += size;

        if (!stats.categories[category]) {
          stats.categories[category] = { count: 0, size: 0 };
        }

        stats.categories[category].count++;
        stats.categories[category].size += size;
      }
    }
  }

  /**
   * 递归删除空目录
   */
  private removeEmptyDirs(dir: string): number {
    let count = 0;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        count += this.removeEmptyDirs(path.join(dir, entry.name));
      }
    }

    const remaining = fs.readdirSync(dir);

    if (remaining.length === 0 && dir !== this.config.basePath) {
      fs.rmdirSync(dir);
      count++;
    }

    return count;
  }

  /**
   * 猜测 MIME 类型
   */
  private guessMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.pdf': 'application/pdf',
      '.json': 'application/json',
    };

    return mimeMap[ext] || 'application/octet-stream';
  }
}

export const mediaStore = new MediaStore();
