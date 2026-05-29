import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from 'fs';
import { join, dirname } from 'path';
import { resolveAttachmentsDir, resolveDataSubDir } from '../config/paths';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 附件类型
 */
export type AttachmentType = 'image' | 'file' | 'code' | 'link' | 'other';

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
  metadata?: Record<string, unknown>;
}

/**
 * 附件管理器
 */
export class AttachmentManager {
  private attachmentsDir: string;
  private fallbackDir: string;

  /**
   * 构造函数
   * @param attachmentsDir 附件存储目录
   */
  constructor(attachmentsDir: string = resolveAttachmentsDir()) {
    this.attachmentsDir = attachmentsDir;
    this.fallbackDir = resolveDataSubDir('attachments');

    // 确保目录存在，如果失败则使用回退目录
    if (!this.ensureDirectoryExists(this.attachmentsDir)) {
      logger.warn(`无法创建用户附件目录 ${this.attachmentsDir}，使用回退目录 ${this.fallbackDir}`);
      this.attachmentsDir = this.fallbackDir;
      this.ensureDirectoryExists(this.attachmentsDir);
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
    const truncatedName = sanitizedName.length > maxNameLength
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
    const extension = extIndex !== -1 ? originalName.substring(extIndex).toLowerCase() : '';

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
      const namePart = sanitized.substring(0, Math.min(availableLength, sanitized.length));
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
   * @param metadata 元数据
   * @returns 附件对象
   */
  saveAttachment(
    name: string,
    data: Buffer,
    type: AttachmentType,
    mimeType: string,
    metadata?: Record<string, unknown>
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
    });
  }
}

// 导出默认实例
export const attachmentManager = new AttachmentManager();
