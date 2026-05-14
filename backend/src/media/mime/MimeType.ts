/**
 * MimeType MIME 类型检测与管理
 * 对标 CC 的 MIME 类型识别能力
 */

/**
 * MIME 类型映射
 */
const MIME_MAP: Record<string, string> = {
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.cjs': 'application/javascript',
  '.jsx': 'text/jsx',
  '.ts': 'application/typescript',
  '.tsx': 'text/typescript-jsx',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

/**
 * 扩展名到 MIME 的逆向映射
 */
const EXT_MAP: Record<string, string[]> = {};

for (const [ext, mime] of Object.entries(MIME_MAP)) {
  if (!EXT_MAP[mime]) {
    EXT_MAP[mime] = [];
  }
  EXT_MAP[mime].push(ext);
}

/**
 * MIME 类型管理器
 */
export class MimeTypeManager {
  /**
   * 根据文件路径获取 MIME 类型
   */
  getType(filePath: string): string {
    const ext = this.getFileExtension(filePath).toLowerCase();
    return MIME_MAP[ext] || 'application/octet-stream';
  }

  /**
   * 根据 MIME 类型获取扩展名
   */
  getExtension(mimeType: string): string {
    const exts = this.getExtensions(mimeType);
    return exts.length > 0 ? exts[0] : '.bin';
  }

  /**
   * 根据 MIME 类型获取所有可能扩展名
   */
  getExtensions(mimeType: string): string[] {
    return EXT_MAP[mimeType] || ['.bin'];
  }

  /**
   * 判断是否为图片类型
   */
  isImage(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  /**
   * 判断是否为视频类型
   */
  isVideo(mimeType: string): boolean {
    return mimeType.startsWith('video/');
  }

  /**
   * 判断是否为音频类型
   */
  isAudio(mimeType: string): boolean {
    return mimeType.startsWith('audio/');
  }

  /**
   * 判断是否为文本类型
   */
  isText(mimeType: string): boolean {
    return mimeType.startsWith('text/') ||
           mimeType === 'application/json' ||
           mimeType === 'application/xml' ||
           mimeType.startsWith('application/javascript');
  }

  /**
   * 判断是否为二进制类型
   */
  isBinary(mimeType: string): boolean {
    return !this.isText(mimeType);
  }

  /**
   * 从文件内容推断 MIME 类型
   */
  detectFromContent(buffer: Buffer): string {
    if (!buffer || buffer.length === 0) return 'application/octet-stream';

    for (let i = 0; i < 4 && i < buffer.length; i++) {
      if (buffer[i] > 0x7F) {
        break;
      }
    }

    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return 'image/png';
    }

    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      return 'image/jpeg';
    }

    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return 'image/gif';
    }

    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return 'application/pdf';
    }

    if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
      return 'application/zip';
    }

    const textSample = buffer.toString('utf-8', 0, Math.min(buffer.length, 100));
    if (/^[\s\w\n\r.,;:!?(){}[\]"'@#$%^&*+=<>/\\\-]+$/.test(textSample)) {
      return 'text/plain';
    }

    return 'application/octet-stream';
  }

  /**
   * 获取文件扩展名
   */
  private getFileExtension(filePath: string): string {
    const idx = filePath.lastIndexOf('.');
    return idx >= 0 ? filePath.slice(idx) : '';
  }
}

export const mimeTypeManager = new MimeTypeManager();
