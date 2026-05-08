//
/**
 * 远程文件同步服务
 * 提供本地与远程服务器之间的文件同步功能
 */

/**
 * 文件同步方向
 */
export enum SyncDirection {
  UPLOAD = 'upload',
  DOWNLOAD = 'download',
  BIDIRECTIONAL = 'bidirectional',
}

/**
 * 文件同步状态
 */
export enum SyncStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * 文件差异类型
 */
export enum DiffType {
  ADDED = 'added',
  MODIFIED = 'modified',
  DELETED = 'deleted',
  UNCHANGED = 'unchanged',
}

/**
 * 文件差异
 */
export interface FileDiff {
  path: string;
  type: DiffType;
  localVersion?: string;
  remoteVersion?: string;
  size?: number;
  modifiedAt?: number;
}

/**
 * 同步配置
 */
export interface SyncConfig {
  localPath: string;
  remotePath: string;
  direction: SyncDirection;
  patterns?: string[];
  excludePatterns?: string[];
  deleteOrphans?: boolean;
  useChecksum?: boolean;
  maxConcurrent?: number;
}

/**
 * 同步任务结果
 */
export interface SyncResult {
  success: boolean;
  direction: SyncDirection;
  uploaded: number;
  downloaded: number;
  deleted: number;
  failed: number;
  skipped: number;
  totalBytes: number;
  duration: number;
  errors: string[];
  fileDiffs: FileDiff[];
}

/**
 * 文件信息
 */
interface FileInfo {
  path: string;
  size: number;
  modifiedAt: number;
  checksum?: string;
  isDirectory: boolean;
}

/**
 * 同步进度回调
 */
export interface SyncProgressCallback {
  onStart?: (totalFiles: number) => void;
  onProgress?: (completedFiles: number, totalFiles: number, currentFile: string) => void;
  onFileComplete?: (file: string, success: boolean) => void;
  onComplete?: (result: SyncResult) => void;
  onError?: (error: string, file?: string) => void;
}

/**
 * 远程文件操作接口
 */
export interface RemoteFileOperations {
  list(path: string): Promise<FileInfo[]>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Buffer): Promise<void>;
  delete(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  stat(path: string): Promise<FileInfo>;
  exists(path: string): Promise<boolean>;
}

/**
 * 本地文件操作接口
 */
interface LocalFileOperations {
  list(path: string): FileInfo[];
  readFile(path: string): Buffer;
  writeFile(path: string, data: Buffer): void;
  delete(path: string): void;
  mkdir(path: string): void;
  stat(path: string): FileInfo;
  exists(path: string): boolean;
}

/**
 * 远程文件同步服务
 */
export class RemoteFileSyncService {
  private localOps: LocalFileOperations;
  private remoteOps: RemoteFileOperations;
  private progressCallback?: SyncProgressCallback;

  /**
   * 构造函数
   */
  constructor(
    localOps: LocalFileOperations,
    remoteOps: RemoteFileOperations,
    progressCallback?: SyncProgressCallback
  ) {
    this.localOps = localOps;
    this.remoteOps = remoteOps;
    this.progressCallback = progressCallback;
  }

  /**
   * 设置进度回调
   */
  public setProgressCallback(callback: SyncProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * 计算文件校验和
   */
  private calculateChecksum(data: Buffer): string {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * 规范化路径
   */
  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/\/+/g, '/');
  }

  /**
   * 获取相对路径
   */
  private getRelativePath(fullPath: string, basePath: string): string {
    const normalizedFull = this.normalizePath(fullPath);
    const normalizedBase = this.normalizePath(basePath);
    return normalizedFull.replace(normalizedBase, '').replace(/^\//, '');
  }

  /**
   * 匹配文件模式
   */
  private matchPattern(filePath: string, patterns: string[]): boolean {
    if (!patterns || patterns.length === 0) return true;

    const normalizedPath = this.normalizePath(filePath);

    for (const pattern of patterns) {
      const regex = this.globToRegex(pattern);
      if (regex.test(normalizedPath)) return true;
    }

    return false;
  }

  /**
   * 排除文件模式
   */
  private shouldExclude(filePath: string, excludePatterns: string[]): boolean {
    if (!excludePatterns || excludePatterns.length === 0) return false;

    const normalizedPath = this.normalizePath(filePath);

    for (const pattern of excludePatterns) {
      const regex = this.globToRegex(pattern);
      if (regex.test(normalizedPath)) return true;
    }

    return false;
  }

  /**
   * Glob模式转正则表达式
   */
  private globToRegex(glob: string): RegExp {
    const escapedGlob = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(escapedGlob, 'i');
  }

  /**
   * 扫描本地目录
   */
  private async scanLocalDirectory(dirPath: string, basePath: string): Promise<Map<string, FileInfo>> {
    const files = new Map<string, FileInfo>();

    const scan = (currentPath: string) => {
      const entries = this.localOps.list(currentPath);

      for (const entry of entries) {
        const relativePath = this.getRelativePath(entry.path, basePath);

        if (this.shouldExclude(relativePath, ['node_modules/**', '.git/**', '*.log'])) {
          continue;
        }

        files.set(relativePath, entry);

        if (entry.isDirectory) {
          scan(entry.path);
        }
      }
    };

    scan(dirPath);
    return files;
  }

  /**
   * 扫描远程目录
   */
  private async scanRemoteDirectory(dirPath: string, basePath: string): Promise<Map<string, FileInfo>> {
    const files = new Map<string, FileInfo>();

    const scan = async (currentPath: string) => {
      try {
        const entries = await this.remoteOps.list(currentPath);

        for (const entry of entries) {
          const relativePath = this.getRelativePath(entry.path, basePath);

          if (this.shouldExclude(relativePath, ['node_modules/**', '.git/**', '*.log'])) {
            continue;
          }

          files.set(relativePath, entry);

          if (entry.isDirectory) {
            await scan(entry.path);
          }
        }
      } catch (error) {
        // 目录不存在或其他错误，忽略
      }
    };

    await scan(dirPath);
    return files;
  }

  /**
   * 比较文件差异
   */
  public async compareFiles(config: SyncConfig): Promise<FileDiff[]> {
    const localFiles = await this.scanLocalDirectory(config.localPath, config.localPath);
    const remoteFiles = await this.scanRemoteDirectory(config.remotePath, config.remotePath);

    const diffs: FileDiff[] = [];

    const processedPaths = new Set<string>();

    for (const [relativePath, localFile] of localFiles) {
      processedPaths.add(relativePath);

      if (this.shouldExclude(relativePath, config.excludePatterns)) {
        continue;
      }

      const remoteFile = remoteFiles.get(relativePath);

      if (!remoteFile) {
        if (config.direction === SyncDirection.UPLOAD || config.direction === SyncDirection.BIDIRECTIONAL) {
          diffs.push({
            path: relativePath,
            type: DiffType.ADDED,
            localVersion: localFile.checksum || String(localFile.modifiedAt),
            size: localFile.size,
            modifiedAt: localFile.modifiedAt,
          });
        }
      } else if (localFile.isDirectory && remoteFile.isDirectory) {
        diffs.push({
          path: relativePath,
          type: DiffType.UNCHANGED,
        });
      } else if (config.useChecksum && localFile.checksum !== remoteFile.checksum) {
        diffs.push({
          path: relativePath,
          type: DiffType.MODIFIED,
          localVersion: localFile.checksum,
          remoteVersion: remoteFile.checksum,
          size: localFile.size,
          modifiedAt: localFile.modifiedAt,
        });
      } else if (localFile.modifiedAt !== remoteFile.modifiedAt) {
        diffs.push({
          path: relativePath,
          type: DiffType.MODIFIED,
          localVersion: String(localFile.modifiedAt),
          remoteVersion: String(remoteFile.modifiedAt),
          size: localFile.size,
          modifiedAt: localFile.modifiedAt,
        });
      }
    }

    if (config.deleteOrphans || config.direction === SyncDirection.BIDIRECTIONAL) {
      for (const [relativePath, remoteFile] of remoteFiles) {
        if (!processedPaths.has(relativePath) && !this.shouldExclude(relativePath, config.excludePatterns || [])) {
          diffs.push({
            path: relativePath,
            type: DiffType.DELETED,
            remoteVersion: remoteFile.checksum || String(remoteFile.modifiedAt),
            size: remoteFile.size,
            modifiedAt: remoteFile.modifiedAt,
          });
        }
      }
    }

    return diffs;
  }

  /**
   * 执行同步
   */
  public async sync(config: SyncConfig): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      success: true,
      direction: config.direction,
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      failed: 0,
      skipped: 0,
      totalBytes: 0,
      duration: 0,
      errors: [],
      fileDiffs: [],
    };

    try {
      const diffs = await this.compareFiles(config);
      result.fileDiffs = diffs;

      const filesToSync = diffs.filter(
        (d) => d.type !== DiffType.UNCHANGED
      );

      this.progressCallback?.onStart?.(filesToSync.length);

      let completed = 0;

      for (const diff of filesToSync) {
        try {
          if (diff.type === DiffType.ADDED || diff.type === DiffType.MODIFIED) {
            if (config.direction === SyncDirection.UPLOAD || config.direction === SyncDirection.BIDIRECTIONAL) {
              await this.uploadFile(diff, config);
              result.uploaded++;
              result.totalBytes += diff.size || 0;
            } else if (config.direction === SyncDirection.DOWNLOAD) {
              await this.downloadFile(diff, config);
              result.downloaded++;
              result.totalBytes += diff.size || 0;
            }
          } else if (diff.type === DiffType.DELETED) {
            if (config.direction === SyncDirection.UPLOAD) {
              await this.deleteRemoteFile(diff, config);
              result.deleted++;
            } else if (config.direction === SyncDirection.BIDIRECTIONAL) {
              await this.deleteLocalFile(diff, config);
              result.deleted++;
            }
          }
        } catch (error) {
          result.failed++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          result.errors.push(`${diff.path}: ${errorMsg}`);
          this.progressCallback?.onError?.(errorMsg, diff.path);
        }

        completed++;
        this.progressCallback?.onProgress?.(completed, filesToSync.length, diff.path);
        this.progressCallback?.onFileComplete?.(diff.path, result.failed === 0);
      }

      result.success = result.failed === 0;

    } catch (error) {
      result.success = false;
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(errorMsg);
      this.progressCallback?.onError?.(errorMsg);
    }

    result.duration = Date.now() - startTime;
    this.progressCallback?.onComplete?.(result);

    return result;
  }

  /**
   * 上传文件
   */
  private async uploadFile(diff: FileDiff, config: SyncConfig): Promise<void> {
    const localPath = `${config.localPath}/${diff.path}`;
    const remotePath = `${config.remotePath}/${diff.path}`;

    if (!this.localOps.exists(localPath)) {
      throw new Error(`Local file not found: ${localPath}`);
    }

    const localInfo = this.localOps.stat(localPath);

    if (localInfo.isDirectory) {
      await this.remoteOps.mkdir(remotePath);
    } else {
      const data = this.localOps.readFile(localPath);
      await this.remoteOps.writeFile(remotePath, data);
    }
  }

  /**
   * 下载文件
   */
  private async downloadFile(diff: FileDiff, config: SyncConfig): Promise<void> {
    const localPath = `${config.localPath}/${diff.path}`;
    const remotePath = `${config.remotePath}/${diff.path}`;

    const data = await this.remoteOps.readFile(remotePath);
    this.localOps.writeFile(localPath, data);
  }

  /**
   * 删除远程文件
   */
  private async deleteRemoteFile(diff: FileDiff, config: SyncConfig): Promise<void> {
    const remotePath = `${config.remotePath}/${diff.path}`;
    await this.remoteOps.delete(remotePath);
  }

  /**
   * 删除本地文件
   */
  private deleteLocalFile(diff: FileDiff, config: SyncConfig): void {
    const localPath = `${config.localPath}/${diff.path}`;
    this.localOps.delete(localPath);
  }
}

/**
 * 创建远程文件同步服务
 */
export function createRemoteFileSyncService(
  localOps: LocalFileOperations,
  remoteOps: RemoteFileOperations,
  progressCallback?: SyncProgressCallback
): RemoteFileSyncService {
  return new RemoteFileSyncService(localOps, remoteOps, progressCallback);
}
