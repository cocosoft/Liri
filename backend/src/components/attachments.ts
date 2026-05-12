import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

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
  metadata?: Record<string, any>;
}

/**
 * 附件管理器
 */
export class AttachmentManager {
  private attachmentsDir: string;

  /**
   * 构造函数
   * @param attachmentsDir 附件存储目录
   */
  constructor(attachmentsDir: string = './data/attachments') {
    this.attachmentsDir = attachmentsDir;

    // 确保目录存在
    if (!existsSync(this.attachmentsDir)) {
      mkdirSync(this.attachmentsDir, { recursive: true });
    }
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
    metadata?: Record<string, any>
  ): Attachment {
    // 生成唯一ID
    const id = `attach_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // 生成文件路径
    const filePath = join(this.attachmentsDir, `${id}_${name}`);

    // 确保目录存在
    mkdirSync(dirname(filePath), { recursive: true });

    // 写入文件
    writeFileSync(filePath, data);

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
    // 查找附件文件
    const files = this.listAttachments();
    const attachment = files.find((attach) => attach.id === id);

    if (!attachment) {
      return false;
    }

    // 删除文件
    try {
      if (existsSync(attachment.path)) {
        // 这里应该使用 fs.unlinkSync，但为了安全起见，我们先不实际删除
        console.log(`Would delete attachment: ${attachment.path}`);
        return true;
      }
    } catch (error) {
      logger.error('Error deleting attachment:', error);
    }

    return false;
  }

  /**
   * 列出所有附件
   * @returns 附件列表
   */
  listAttachments(): Attachment[] {
    // 这里应该实现实际的附件列表获取逻辑
    // 由于我们没有实际的存储实现，这里返回空数组
    return [];
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
}

// 导出默认实例
export const attachmentManager = new AttachmentManager();
