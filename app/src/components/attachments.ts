import { Logger, LogLevel } from '@modules/monitoring';
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from 'fs';
import { join, dirname } from 'path';
import {
  resolveAttachmentsDir,
  resolveDataSubDir,
  resolveDbPath,
} from '@modules/core';
import { Database } from '@modules/core/external/sqlite3';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 附件类型
 */
export type AttachmentType = 'image' | 'file' | 'code' | 'link' | 'other';

/**
 * 附件来源枚举
 */
export enum AttachmentSource {
  /** 会话中用户上传的文件 */
  SESSION = 'session',
  /** 任务系统生成的文件 */
  TASK = 'task',
  /** 开发工具生成的文件 */
  DEVELOPMENT = 'development',
  /** 知识库自动上传 */
  KNOWLEDGE_AUTO = 'knowledge_auto',
}

/**
 * 附件来源元数据
 */
export interface AttachmentMetadata {
  /** 来源枚举 */
  source: AttachmentSource;
  /** 来源ID（如会话ID、任务ID） */
  sourceId?: string;
  /** 来源描述 */
  description?: string;
  /** 原始文件名 */
  originalName?: string;
  /** 转换后内容（PPTX→Markdown 等） */
  convertedContent?: string;
}

/**
 * 附件
 */
export interface Attachment {
  id: string;
  name: string;
  type: AttachmentType;
  path: string;
  size: number;
  mimeType: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: AttachmentMetadata;
}

/**
 * 附件管理器
 */
export class AttachmentManager {
  private attachmentsDir: string;
  private fallbackDir: string;
  private db: Database | null = null;

  /**
   * 构造函数
   * @param attachmentsDir 附件存储目录
   * @param dbPath 数据库路径
   */
  constructor(
    attachmentsDir: string = resolveAttachmentsDir(),
    private dbPath: string = resolveDbPath()
  ) {
    this.attachmentsDir = attachmentsDir;
    this.fallbackDir = resolveDataSubDir('attachments');

    // 确保目录存在，如果失败则使用回退目录
    if (!this.ensureDirectoryExists(this.attachmentsDir)) {
      logger.warn(
        `无法创建用户附件目录 ${this.attachmentsDir}，使用回退目录 ${this.fallbackDir}`
      );
      this.attachmentsDir = this.fallbackDir;
      this.ensureDirectoryExists(this.attachmentsDir);
    }

    // 初始化数据库表
    this.initDatabase();
  }

  /**
   * 初始化数据库，创建 attachments_sources 表
   */
  private initDatabase(): void {
    try {
      this.db = new Database(this.dbPath);

      this.db.run(
        `
        CREATE TABLE IF NOT EXISTS attachments_sources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          attachment_id TEXT NOT NULL,
          source TEXT NOT NULL,
          source_id TEXT,
          description TEXT,
          original_name TEXT,
          file_path TEXT,
          mime_type TEXT,
          file_size INTEGER,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )
      `,
        (err: Error | null) => {
          if (err) {
            logger.error('创建 attachments_sources 表失败', {
              error: err.message,
            });
            this.closeDb();
          } else {
            logger.info('attachments_sources 表创建/验证完成');
          }
        }
      );

      this.db.run(
        `CREATE INDEX IF NOT EXISTS idx_attachments_sources_source
         ON attachments_sources(source)`
      );

      this.db.run(
        `CREATE INDEX IF NOT EXISTS idx_attachments_sources_source_id
         ON attachments_sources(source_id)`
      );
    } catch (err) {
      logger.error('初始化附件数据库失败', { error: String(err) });
      this.closeDb();
    }
  }

  /** 关闭数据库连接 */
  private closeDb(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        /* 忽略关闭错误 */
      }
      this.db = null;
    }
  }

  /**
   * 确保目录存在
   * @param dirPath 目录路径
   * @returns 是否成功创建/存在
   */
  private ensureDirectoryExists(dirPath: string): boolean {
    try {
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }
      // 验证可写性
      const testFile = join(dirPath, '.write_test');
      writeFileSync(testFile, '');
      unlinkSync(testFile);
      return true;
    } catch (error) {
      logger.error(`无法创建或写入目录 ${dirPath}:`, error);
      return false;
    }
  }

  /**
   * 获取索引文件路径
   */
  private get indexPath(): string {
    return join(this.attachmentsDir, '_index.json');
  }

  /**
   * 加载索引
   */
  private loadIndex(): Attachment[] {
    try {
      if (existsSync(this.indexPath)) {
        const raw = readFileSync(this.indexPath, 'utf-8');
        const parsed = JSON.parse(raw);
        // 将 createdAt / updatedAt 字符串还原为 Date
        return parsed.map((a: Attachment) => ({
          ...a,
          createdAt: new Date(a.createdAt),
          updatedAt: new Date(a.updatedAt),
        }));
      }
    } catch {
      // 索引文件损坏时重建
    }
    return [];
  }

  /**
   * 保存索引
   */
  private saveIndex(attachments: Attachment[]): void {
    writeFileSync(
      this.indexPath,
      JSON.stringify(attachments, null, 2),
      'utf-8'
    );
  }

  /**
   * 清理文件名，移除特殊字符并限制长度
   * @param filename 原始文件名
   * @returns 清理后的文件名
   */
  private sanitizeFilename(filename: string): string {
    // 分离文件名和扩展名
    const extIndex = filename.lastIndexOf('.');
    let namePart = filename;
    let extension = '';

    if (extIndex !== -1) {
      namePart = filename.substring(0, extIndex);
      extension = filename.substring(extIndex);
    }

    // 移除特殊字符，保留字母、数字和基本符号
    // 将中文替换为拼音首字母或简单标识
    const sanitizedName = namePart
      .replace(/[\u4e00-\u9fa5]/g, (char) => {
        // 简单处理：中文替换为 'CN' 标记
        return 'CN';
      })
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/[\s]+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '');

    // 限制文件名部分长度（总长度限制留给外部处理）
    const maxNameLength = 32;
    const truncatedName =
      sanitizedName.length > maxNameLength
        ? sanitizedName.substring(0, maxNameLength)
        : sanitizedName;

    return `${truncatedName}${extension}`;
  }

  /**
   * 生成安全的文件名
   * @param originalName 原始文件名
   * @returns 安全的文件名（仅包含ASCII字符，长度可控）
   */
  private generateSafeFilename(originalName: string): string {
    // 获取扩展名
    const extIndex = originalName.lastIndexOf('.');
    const extension =
      extIndex !== -1 ? originalName.substring(extIndex).toLowerCase() : '';

    // 使用时间戳 + 随机字符串作为基础文件名
    const timestamp = Date.now().toString(36);
    const randomStr = Math.random().toString(36).substring(2, 8);

    // 限制总长度（Windows 最大路径限制为 260，这里保守设置为 100）
    const maxTotalLength = 100;
    const baseName = `attach_${timestamp}_${randomStr}`;

    // 计算可用长度（减去基础名称和扩展名）
    const availableLength = maxTotalLength - baseName.length - extension.length;

    // 如果有可用空间，添加简化的原始文件名
    let safeName = baseName;
    if (availableLength > 0) {
      const sanitized = this.sanitizeFilename(originalName);
      const namePart = sanitized.substring(
        0,
        Math.min(availableLength, sanitized.length)
      );
      if (namePart) {
        safeName = `${baseName}_${namePart}`;
      }
    }

    return `${safeName}${extension}`;
  }

  /**
   * 保存附件
   * @param name 附件名称
   * @param data 附件数据
   * @param type 附件类型
   * @param mimeType MIME类型
   * @param source 附件来源
   * @param sourceId 来源ID（如会话ID、任务ID）
   * @param description 来源描述
   * @returns 附件对象
   */
  saveAttachment(
    name: string,
    data: Buffer,
    type: AttachmentType,
    mimeType: string,
    source: AttachmentSource = AttachmentSource.SESSION,
    sourceId?: string,
    description?: string
  ): Attachment {
    // 生成唯一ID
    const id = `attach_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // 生成安全的文件路径（使用简化的文件名）
    const safeFilename = this.generateSafeFilename(name);
    let filePath = join(this.attachmentsDir, safeFilename);

    // 确保目录存在
    mkdirSync(dirname(filePath), { recursive: true });

    // 写入文件，失败时尝试回退目录
    try {
      writeFileSync(filePath, data);
    } catch (error) {
      logger.error(`写入附件失败 ${filePath}:`, error);

      // 尝试使用回退目录
      if (this.attachmentsDir !== this.fallbackDir) {
        logger.warn(`尝试使用回退目录 ${this.fallbackDir}`);
        this.ensureDirectoryExists(this.fallbackDir);
        filePath = join(this.fallbackDir, safeFilename);
        writeFileSync(filePath, data);
        // 更新当前使用的目录
        this.attachmentsDir = this.fallbackDir;
      } else {
        throw new Error(`无法保存附件: ${(error as Error).message}`);
      }
    }

    // 构建来源元数据
    const metadata: AttachmentMetadata = {
      source,
      sourceId,
      description: description || `附件类型: ${type}, MIME: ${mimeType}`,
      originalName: name,
    };

    // 创建附件对象
    const attachment: Attachment = {
      id,
      name,
      type,
      path: filePath,
      size: data.length,
      mimeType,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata,
    };

    // 更新索引
    const index = this.loadIndex();
    index.push(attachment);
    this.saveIndex(index);

    // 记录附件来源到数据库
    this.recordAttachmentSource(attachment);

    // 注册到 FileRegistry 文件注册中心
    this.registerAttachmentToFileRegistry(attachment, data);

    this.autoIngestAttachment(attachment);

    return attachment;
  }

  /**
   * 读取附件
   * @param id 附件ID
   * @returns 附件数据
   */
  readAttachment(id: string): Buffer | null {
    // 查找附件文件
    const files = this.listAttachments();
    const attachment = files.find((attach) => attach.id === id);

    if (!attachment) {
      return null;
    }

    // 读取文件
    if (existsSync(attachment.path)) {
      return readFileSync(attachment.path);
    }

    return null;
  }

  /**
   * 删除附件
   * @param id 附件ID
   * @returns 是否删除成功
   */
  deleteAttachment(id: string): boolean {
    const index = this.loadIndex();
    const idx = index.findIndex((a) => a.id === id);

    if (idx === -1) {
      return false;
    }

    const attachment = index[idx];

    // 删除文件
    try {
      if (existsSync(attachment.path)) {
        unlinkSync(attachment.path);
      }
      // 从索引中移除
      index.splice(idx, 1);
      this.saveIndex(index);
      return true;
    } catch (error) {
      logger.error('Error deleting attachment:', error);
      return false;
    }
  }

  /**
   * 列出所有附件
   * @returns 附件列表
   */
  listAttachments(): Attachment[] {
    return this.loadIndex();
  }

  /**
   * 获取附件信息
   * @param id 附件ID
   * @returns 附件对象或null
   */
  getAttachment(id: string): Attachment | null {
    const files = this.listAttachments();
    return files.find((attach) => attach.id === id) || null;
  }

  /**
   * 清理过期附件
   * @param days 天数阈值
   * @returns 删除的附件数量
   */
  cleanupOldAttachments(days: number): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const files = this.listAttachments();
    let deletedCount = 0;

    files.forEach((attachment) => {
      if (attachment.createdAt < cutoffDate) {
        if (this.deleteAttachment(attachment.id)) {
          deletedCount++;
        }
      }
    });

    return deletedCount;
  }

  /**
   * 记录附件来源到数据库
   */
  private recordAttachmentSource(attachment: Attachment): void {
    if (!this.db) return;

    const metadata = attachment.metadata;
    this.db.run(
      `INSERT INTO attachments_sources (attachment_id, source, source_id, description, original_name, file_path, mime_type, file_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attachment.id,
        metadata?.source || 'session',
        metadata?.sourceId || null,
        metadata?.description || null,
        metadata?.originalName || attachment.name,
        attachment.path,
        attachment.mimeType,
        attachment.size,
      ]
    );
  }

  /**
   * 按来源查询附件记录
   * @param source 来源枚举值
   * @param limit 限制条数
   * @returns 附件来源记录列表
   */
  queryAttachmentsBySource(
    source: AttachmentSource | string,
    limit: number = 50
  ): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve([]);
        return;
      }
      this.db!.all(
        `SELECT * FROM attachments_sources WHERE source = ? ORDER BY created_at DESC LIMIT ?`,
        [source, limit],
        (err: Error | null, rows: Record<string, unknown>[]) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * 按来源ID查询附件记录
   * @param sourceId 来源ID（如会话ID、任务ID）
   * @param limit 限制条数
   * @returns 附件来源记录列表
   */
  queryAttachmentsBySourceId(
    sourceId: string,
    limit: number = 50
  ): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve([]);
        return;
      }
      this.db!.all(
        `SELECT * FROM attachments_sources WHERE source_id = ? ORDER BY created_at DESC LIMIT ?`,
        [sourceId, limit],
        (err: Error | null, rows: Record<string, unknown>[]) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * 附件保存后自动触发知识库摄取
   * 异步执行，不阻塞附件保存
   */
  private autoIngestAttachment(attachment: Attachment): void {
    Promise.resolve().then(async () => {
      try {
        const { getDefaultIngestionService } =
          await import('../knowledge/ingestion/FileIngestionService');
        const service = getDefaultIngestionService();
        await service.ingestFile(attachment.path, 'attachment', {
          description: `附件类型: ${attachment.type}, MIME: ${attachment.mimeType}`,
        });
        logger.info('附件已自动摄取到知识库', {
          name: attachment.name,
          path: attachment.path,
          type: attachment.type,
        });
      } catch {
        // 静默失败，不干扰主流程
      }

      // 同步写入知识库 raw 目录，按来源分类存储
      try {
        const { writeFile, mkdir } = await import('fs/promises');
        const { join } = await import('path');
        const { resolvePyappHome } = await import('@modules/core/paths');
        const metadata = attachment.metadata;

        // 构建 raw 目录路径：~/.pyapp/knowledge/raw/{source}/{sourceId}/
        const rawDir = join(
          resolvePyappHome(),
          'knowledge',
          'raw',
          metadata?.source || 'session',
          metadata?.sourceId || 'unknown'
        );
        await mkdir(rawDir, { recursive: true });

        // 写入 raw 元数据文件记录附件来源
        const metaContent = JSON.stringify(
          {
            attachmentId: attachment.id,
            name: attachment.name,
            type: attachment.type,
            mimeType: attachment.mimeType,
            originalPath: attachment.path,
            source: metadata?.source,
            sourceId: metadata?.sourceId,
            description: metadata?.description,
            savedAt: new Date().toISOString(),
          },
          null,
          2
        );
        const metaFileName = `${attachment.id}.meta.json`;
        await writeFile(join(rawDir, metaFileName), metaContent, 'utf-8');

        logger.info('附件来源已记录到知识库 raw 目录', {
          rawDir,
          source: metadata?.source,
          sourceId: metadata?.sourceId,
        });
      } catch {
        // 静默失败，不干扰主流程
      }
    });
  }

  /**
   * 将附件注册到 FileRegistry 文件注册中心
   * 异步执行，不阻塞附件保存主流程
   */
  private registerAttachmentToFileRegistry(
    attachment: Attachment,
    data: Buffer
  ): void {
    Promise.resolve().then(async () => {
      try {
        const { FileRegistry } =
          await import('@modules/services/file/FileRegistry');
        const { FileSource } = await import('@modules/services/file/types');

        const metadata = attachment.metadata;
        const source =
          metadata?.source === AttachmentSource.KNOWLEDGE_AUTO
            ? FileSource.AUTO_INGEST
            : FileSource.UPLOAD;

        const registry = FileRegistry.getInstance();
        await registry.initDatabase();

        await registry.registerFile({
          originalName: attachment.name,
          content: data,
          source,
          sourceId: metadata?.sourceId || 'attachment',
          mimeType: attachment.mimeType,
          description: metadata?.description || `附件类型: ${attachment.type}`,
          storeZone: 'inbound',
        });

        logger.info('附件已注册到 FileRegistry', {
          name: attachment.name,
          source,
          fileId: attachment.id,
        });
      } catch {
        // 静默失败，不干扰主流程
      }
    });
  }
}

// 导出默认实例
export const attachmentManager = new AttachmentManager();
