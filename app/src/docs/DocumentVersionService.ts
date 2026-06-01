/**
 * 文档版本管理服务
 * 提供文档版本控制、历史记录和回滚功能
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolveDataSubDir } from '@modules/config/paths';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 文档版本状态
 */
export enum DocumentVersionStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
  DELETED = 'deleted',
}

/**
 * 文档版本元数据
 */
export interface DocumentVersionMetadata {
  id: string;
  documentId: string;
  version: number;
  status: DocumentVersionStatus;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  description?: string;
  checksum: string;
  size: number;
}

/**
 * 文档版本内容
 */
export interface DocumentVersionContent {
  metadata: DocumentVersionMetadata;
  content: string;
}

/**
 * 文档版本历史记录
 */
export interface DocumentVersionHistory {
  documentId: string;
  versions: DocumentVersionMetadata[];
  totalVersions: number;
}

/**
 * 文档版本比较结果
 */
export interface DocumentVersionDiff {
  documentId: string;
  fromVersion: number;
  toVersion: number;
  additions: string[];
  deletions: string[];
  modifications: string[];
}

/**
 * 文档版本配置
 */
export interface DocumentVersionConfig {
  storageDir: string;
  maxVersions: number;
  enableCompression: boolean;
  enableChecksum: boolean;
  autoCleanup: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: DocumentVersionConfig = {
  storageDir: resolveDataSubDir('document_versions'),
  maxVersions: 100,
  enableCompression: false,
  enableChecksum: true,
  autoCleanup: true,
};

/**
 * 文档版本服务
 */
export class DocumentVersionService {
  private config: DocumentVersionConfig;
  private versions: Map<string, Map<number, DocumentVersionMetadata>> =
    new Map();
  private documentCurrentVersion: Map<string, number> = new Map();

  /**
   * 构造函数
   */
  constructor(config?: Partial<DocumentVersionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupStorageDir();
  }

  /**
   * 设置存储目录
   */
  private setupStorageDir(): void {
    if (!fs.existsSync(this.config.storageDir)) {
      fs.mkdirSync(this.config.storageDir, { recursive: true });
    }
  }

  /**
   * 生成文档ID
   */
  private generateDocumentId(title: string): string {
    const hash = crypto.createHash('md5').update(title).digest('hex');
    return hash.substring(0, 12);
  }

  /**
   * 生成版本ID
   */
  private generateVersionId(documentId: string, version: number): string {
    return `${documentId}_v${version}`;
  }

  /**
   * 计算校验和
   */
  private calculateChecksum(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * 获取版本文件路径
   */
  private getVersionFilePath(documentId: string, version: number): string {
    return path.join(
      this.config.storageDir,
      `${this.generateVersionId(documentId, version)}.json`
    );
  }

  /**
   * 获取元数据文件路径
   */
  private getMetadataFilePath(documentId: string): string {
    return path.join(this.config.storageDir, `${documentId}_metadata.json`);
  }

  /**
   * 保存版本内容
   */
  private saveVersionContent(
    documentId: string,
    version: number,
    content: string
  ): void {
    const versionContent: DocumentVersionContent = {
      metadata: {
        id: this.generateVersionId(documentId, version),
        documentId,
        version,
        status: DocumentVersionStatus.ACTIVE,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        checksum: this.config.enableChecksum
          ? this.calculateChecksum(content)
          : '',
        size: content.length,
      },
      content,
    };

    const filePath = this.getVersionFilePath(documentId, version);
    fs.writeFileSync(filePath, JSON.stringify(versionContent, null, 2), 'utf8');
  }

  /**
   * 加载版本内容
   */
  private loadVersionContent(
    documentId: string,
    version: number
  ): DocumentVersionContent | null {
    const filePath = this.getVersionFilePath(documentId, version);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      logger.error(
        `Failed to load version ${version} for document ${documentId}:`,
        error
      );
      return null;
    }
  }

  /**
   * 保存文档元数据
   */
  private saveDocumentMetadata(documentId: string): void {
    const versions = this.versions.get(documentId);
    if (!versions) return;

    const metadataFilePath = this.getMetadataFilePath(documentId);
    const metadata = Array.from(versions.values());

    fs.writeFileSync(
      metadataFilePath,
      JSON.stringify(metadata, null, 2),
      'utf8'
    );
  }

  /**
   * 加载文档元数据
   */
  private loadDocumentMetadata(documentId: string): void {
    const metadataFilePath = this.getMetadataFilePath(documentId);

    if (!fs.existsSync(metadataFilePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(metadataFilePath, 'utf8');
      const metadataList: DocumentVersionMetadata[] = JSON.parse(content);

      const versionsMap = new Map<number, DocumentVersionMetadata>();
      for (const metadata of metadataList) {
        versionsMap.set(metadata.version, metadata);
      }

      this.versions.set(documentId, versionsMap);

      const currentVersion = Math.max(...metadataList.map((m) => m.version));
      this.documentCurrentVersion.set(documentId, currentVersion);
    } catch (error) {
      logger.error(
        `Failed to load metadata for document ${documentId}:`,
        error
      );
    }
  }

  /**
   * 创建新文档版本
   */
  public createVersion(
    title: string,
    content: string,
    options?: {
      createdBy?: string;
      description?: string;
    }
  ): DocumentVersionMetadata {
    const documentId = this.generateDocumentId(title);

    if (!this.versions.has(documentId)) {
      this.versions.set(documentId, new Map());
      this.loadDocumentMetadata(documentId);
    }

    const currentVersion = this.documentCurrentVersion.get(documentId) || 0;
    const newVersion = currentVersion + 1;

    this.saveVersionContent(documentId, newVersion, content);

    const metadata: DocumentVersionMetadata = {
      id: this.generateVersionId(documentId, newVersion),
      documentId,
      version: newVersion,
      status: DocumentVersionStatus.ACTIVE,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: options?.createdBy,
      description: options?.description,
      checksum: this.config.enableChecksum
        ? this.calculateChecksum(content)
        : '',
      size: content.length,
    };

    const versionsMap = this.versions.get(documentId)!;
    versionsMap.set(newVersion, metadata);

    this.documentCurrentVersion.set(documentId, newVersion);
    this.saveDocumentMetadata(documentId);

    if (this.config.autoCleanup) {
      this.cleanupOldVersions(documentId);
    }

    return metadata;
  }

  /**
   * 获取文档版本
   */
  public getVersion(
    documentId: string,
    version: number
  ): DocumentVersionContent | null {
    if (!this.versions.has(documentId)) {
      this.versions.set(documentId, new Map());
      this.loadDocumentMetadata(documentId);
    }

    return this.loadVersionContent(documentId, version);
  }

  /**
   * 获取文档最新版本
   */
  public getLatestVersion(documentId: string): DocumentVersionContent | null {
    if (!this.versions.has(documentId)) {
      this.versions.set(documentId, new Map());
      this.loadDocumentMetadata(documentId);
    }

    const currentVersion = this.documentCurrentVersion.get(documentId);
    if (!currentVersion) {
      return null;
    }

    return this.loadVersionContent(documentId, currentVersion);
  }

  /**
   * 获取文档版本历史
   */
  public getVersionHistory(documentId: string): DocumentVersionHistory {
    if (!this.versions.has(documentId)) {
      this.versions.set(documentId, new Map());
      this.loadDocumentMetadata(documentId);
    }

    const versionsMap = this.versions.get(documentId)!;
    const versions = Array.from(versionsMap.values())
      .filter((v) => v.status !== DocumentVersionStatus.DELETED)
      .sort((a, b) => b.version - a.version);

    return {
      documentId,
      versions,
      totalVersions: versions.length,
    };
  }

  /**
   * 回滚到指定版本
   */
  public rollback(
    documentId: string,
    targetVersion: number
  ): DocumentVersionMetadata | null {
    const targetContent = this.loadVersionContent(documentId, targetVersion);
    if (!targetContent) {
      return null;
    }

    return this.createVersion(documentId, targetContent.content, {
      createdBy: targetContent.metadata.createdBy,
      description: `Rollback to version ${targetVersion}`,
    });
  }

  /**
   * 比较两个版本
   */
  public compareVersions(
    documentId: string,
    fromVersion: number,
    toVersion: number
  ): DocumentVersionDiff | null {
    const fromContent = this.loadVersionContent(documentId, fromVersion);
    const toContent = this.loadVersionContent(documentId, toVersion);

    if (!fromContent || !toContent) {
      return null;
    }

    const fromLines = fromContent.content.split('\n');
    const toLines = toContent.content.split('\n');

    const additions: string[] = [];
    const deletions: string[] = [];
    const modifications: string[] = [];

    const fromSet = new Set(fromLines);
    const toSet = new Set(toLines);

    for (const line of toLines) {
      if (!fromSet.has(line)) {
        if (
          fromSet.size > 0 &&
          fromLines.some((f) => f.includes(line) || line.includes(f))
        ) {
          modifications.push(line);
        } else {
          additions.push(line);
        }
      }
    }

    for (const line of fromLines) {
      if (!toSet.has(line)) {
        if (!additions.includes(line) && !modifications.includes(line)) {
          deletions.push(line);
        }
      }
    }

    return {
      documentId,
      fromVersion,
      toVersion,
      additions,
      deletions,
      modifications,
    };
  }

  /**
   * 删除文档版本
   */
  public deleteVersion(documentId: string, version: number): boolean {
    if (!this.versions.has(documentId)) {
      return false;
    }

    const versionsMap = this.versions.get(documentId)!;
    const metadata = versionsMap.get(version);

    if (!metadata) {
      return false;
    }

    metadata.status = DocumentVersionStatus.DELETED;
    metadata.updatedAt = Date.now();

    this.saveDocumentMetadata(documentId);

    return true;
  }

  /**
   * 归档文档版本
   */
  public archiveVersion(documentId: string, version: number): boolean {
    if (!this.versions.has(documentId)) {
      return false;
    }

    const versionsMap = this.versions.get(documentId)!;
    const metadata = versionsMap.get(version);

    if (!metadata) {
      return false;
    }

    metadata.status = DocumentVersionStatus.ARCHIVED;
    metadata.updatedAt = Date.now();

    this.saveDocumentMetadata(documentId);

    return true;
  }

  /**
   * 清理旧版本
   */
  private cleanupOldVersions(documentId: string): void {
    const versionsMap = this.versions.get(documentId);
    if (!versionsMap) return;

    const versions = Array.from(versionsMap.values())
      .filter((v) => v.status === DocumentVersionStatus.ACTIVE)
      .sort((a, b) => b.version - a.version);

    if (versions.length > this.config.maxVersions) {
      const versionsToDelete = versions.slice(this.config.maxVersions);

      for (const version of versionsToDelete) {
        const filePath = this.getVersionFilePath(documentId, version.version);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        versionsMap.delete(version.version);
      }

      this.saveDocumentMetadata(documentId);
    }
  }

  /**
   * 验证版本完整性
   */
  public verifyVersionIntegrity(documentId: string, version: number): boolean {
    const content = this.loadVersionContent(documentId, version);
    if (!content) {
      return false;
    }

    if (!this.config.enableChecksum) {
      return true;
    }

    const calculatedChecksum = this.calculateChecksum(content.content);
    return calculatedChecksum === content.metadata.checksum;
  }

  /**
   * 获取版本统计信息
   */
  public getVersionStats(): {
    totalDocuments: number;
    totalVersions: number;
    totalSize: number;
  } {
    let totalVersions = 0;
    let totalSize = 0;

    for (const [documentId, versionsMap] of this.versions) {
      for (const metadata of versionsMap.values()) {
        if (metadata.status === DocumentVersionStatus.ACTIVE) {
          totalVersions++;
          totalSize += metadata.size;
        }
      }
    }

    return {
      totalDocuments: this.versions.size,
      totalVersions,
      totalSize,
    };
  }

  /**
   * 导出文档到指定版本
   */
  public exportVersion(
    documentId: string,
    version: number,
    outputPath: string
  ): boolean {
    const content = this.loadVersionContent(documentId, version);
    if (!content) {
      return false;
    }

    try {
      fs.writeFileSync(outputPath, content.content, 'utf8');
      return true;
    } catch (error) {
      logger.error('Failed to export version:', error);
      return false;
    }
  }

  /**
   * 导入版本
   */
  public importVersion(
    title: string,
    filePath: string,
    options?: {
      createdBy?: string;
      description?: string;
    }
  ): DocumentVersionMetadata | null {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return this.createVersion(title, content, options);
    } catch (error) {
      logger.error('Failed to import version:', error);
      return null;
    }
  }
}

/**
 * 创建文档版本服务实例
 */
export function createDocumentVersionService(
  config?: Partial<DocumentVersionConfig>
): DocumentVersionService {
  return new DocumentVersionService(config);
}

/**
 * 默认文档版本服务实例
 */
let defaultService: DocumentVersionService | null = null;

/**
 * 获取默认文档版本服务
 */
export function getDefaultDocumentVersionService(): DocumentVersionService {
  if (!defaultService) {
    defaultService = new DocumentVersionService();
  }
  return defaultService;
}
