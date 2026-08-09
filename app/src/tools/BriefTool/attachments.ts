/**
 * BriefTool 附件处理模块
 */

import { existsSync } from 'fs';
import { stat } from 'fs/promises';
import { extname, isAbsolute, resolve } from 'path';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:BriefTool:attachments',
  level: LogLevel.INFO,
});

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.svg',
]);

export interface AttachmentResult {
  path: string;
  size: number;
  isImage: boolean;
}

export interface AttachmentOptions {
  replBridgeEnabled?: boolean;
  signal?: AbortSignal;
}

/**
 * 验证附件路径
 */
export async function validateAttachmentPaths(
  paths: string[]
): Promise<{ result: boolean; message?: string }> {
  if (!paths || paths.length === 0) {
    return { result: true };
  }

  for (const path of paths) {
    const resolvedPath = resolvePath(path);

    if (!existsSync(resolvedPath)) {
      return {
        result: false,
        message: `Attachment file not found: ${path}`,
      };
    }

    try {
      const stats = await stat(resolvedPath);
      if (!stats.isFile()) {
        return {
          result: false,
          message: `Attachment is not a file: ${path}`,
        };
      }
    } catch (error) {
      return {
        result: false,
        message: `Cannot access attachment: ${path}`,
      };
    }
  }

  return { result: true };
}

/**
 * 解析附件路径
 */
export async function resolveAttachments(
  paths: string[],
  options: AttachmentOptions = {}
): Promise<AttachmentResult[]> {
  if (!paths || paths.length === 0) {
    return [];
  }

  const results: AttachmentResult[] = [];

  for (const path of paths) {
    try {
      if (options.signal?.aborted) {
        break;
      }

      const resolvedPath = resolvePath(path);

      if (!existsSync(resolvedPath)) {
        continue;
      }

      const stats = await stat(resolvedPath);
      const ext = extname(resolvedPath).toLowerCase();
      const isImage = IMAGE_EXTENSIONS.has(ext);

      results.push({
        path: resolvedPath,
        size: stats.size,
        isImage,
      });
    } catch (error) {
      // 跳过无效的附件
      continue;
    }
  }

  return results;
}

/**
 * 解析路径（支持相对路径和绝对路径）
 */
function resolvePath(path: string): string {
  if (isAbsolute(path)) {
    return path;
  }
  return resolve(process.cwd(), path);
}
