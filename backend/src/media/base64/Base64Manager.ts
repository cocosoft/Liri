/**
 * Base64Manager Base64 编解码管理
 * 对标 CC 的媒体 Base64 处理能力
 */
import fs from 'node:fs';
import path from 'node:path';

export interface Base64EncodeOptions {
  includeDataUri: boolean;
  mimeType?: string;
}

/**
 * Base64 管理器
 */
export class Base64Manager {
  /**
   * 编码文件为 Base64
   */
  encodeFromFile(filePath: string, options?: Base64EncodeOptions): string | null {
    try {
      if (!fs.existsSync(filePath)) return null;

      const data = fs.readFileSync(filePath);
      const base64 = data.toString('base64');

      if (options?.includeDataUri) {
        const mime = options?.mimeType || this.guessMimeType(filePath);

        return `data:${mime};base64,${base64}`;
      }

      return base64;
    } catch {
      return null;
    }
  }

  /**
   * 编码字符串
   */
  encodeString(str: string): string {
    return Buffer.from(str, 'utf-8').toString('base64');
  }

  /**
   * 解码 Base64 到字符串
   */
  decodeToString(base64: string): string | null {
    try {
      const clean = base64.includes(';base64,') ? base64.split(';base64,')[1] : base64;

      return Buffer.from(clean, 'base64').toString('utf-8');
    } catch {
      return null;
    }
  }

  /**
   * 解码 Base64 到文件
   */
  decodeToFile(base64: string, outputPath: string): boolean {
    try {
      const clean = base64.includes(';base64,') ? base64.split(';base64,')[1] : base64;
      const data = Buffer.from(clean, 'base64');

      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(outputPath, data);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取数据 URI 信息
   */
  parseDataUri(dataUri: string): { mimeType: string; base64: string } | null {
    const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);

    if (!match) return null;

    return { mimeType: match[1], base64: match[2] };
  }

  /**
   * 判断是否为有效 Base64
   */
  isValid(base64: string): boolean {
    try {
      const clean = base64.includes(';base64,') ? base64.split(';base64,')[1] : base64;

      return /^[A-Za-z0-9+/]*={0,2}$/.test(clean.trim());
    } catch {
      return false;
    }
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
      '.ico': 'image/x-icon',
      '.pdf': 'application/pdf',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.json': 'application/json',
      '.txt': 'text/plain',
      '.html': 'text/html',
    };

    return mimeMap[ext] || 'application/octet-stream';
  }
}

export const base64Manager = new Base64Manager();
