/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * 媒体文件注册辅助函数
 *
 * AI 生成工具（Image/Video/MusicGenerateTool）完成生成后，
 * 将远程 URL 内容下载到本地 media/generated/ 目录并注册到 FileRegistry。
 */

import path from 'node:path';
import { FileRegistry } from './FileRegistry';
import { FileSource } from './types';
import type { MediaType } from './types';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ module: 'services:file', level: LogLevel.INFO });

/**
 * 下载远程媒体文件并注册到 FileRegistry
 *
 * @param url       远程媒体文件 URL
 * @param prompt    生成提示词（用于描述字段）
 * @param mediaType 媒体子类型（'image' | 'video' | 'music'）
 * @param format    文件扩展名（'png' | 'jpeg' | 'mp4' | 'mp3' 等）
 * @returns 注册结果，包含 fileId 和本地保存路径
 */
export async function registerGeneratedMedia(
  url: string,
  prompt: string,
  mediaType: MediaType,
  format: string
): Promise<{ fileId: string; savedPath: string; savedFullPath: string } | null> {
  try {
    // Step 1: 下载远程文件
    const response = await fetch(url);
    if (!response.ok) {
      logger.warn('下载远程媒体文件失败', {
        status: response.status,
        statusText: response.statusText,
        url: url.slice(0, 200),
      });
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const content = Buffer.from(arrayBuffer);

    // Step 2: 注册到 FileRegistry（路径由 FileRegistry.resolveSavedPath 决定）
    const registry = FileRegistry.getInstance();
    await registry.initDatabase();
    const result = await registry.registerFile({
      originalName: `generated_${Date.now()}.${format}`,
      content,
      source: FileSource.TOOL_GENERATE,
      sourceId: url,
      description: `AI 生成: ${prompt.slice(0, 200)}`,
      mimeType: getMimeType(mediaType, format),
      storeZone: 'media',
      mediaType,
    });

    logger.info('媒体文件已注册到本地', {
      fileId: result.fileId,
      savedPath: result.savedPath,
    });

    // 返回文件名（相对于媒体根目录）和完整路径
    // - savedPath: 文件名，用于前端 URL 构造（如 /v1/images/static/media/xxx）
    // - savedFullPath: 完整文件系统路径，供后续工具（如 image_analysis）直接读取
    return {
      fileId: result.fileId,
      savedPath: path.basename(result.savedPath),
      savedFullPath: result.savedPath,
    };
  } catch (err) {
    logger.error('注册媒体文件异常', {
      error: err instanceof Error ? err.message : String(err),
      url: url.slice(0, 200),
    });
    return null;
  }
}

/**
 * 根据媒体类型和格式返回 MIME 类型
 */
function getMimeType(mediaType: MediaType, format: string): string {
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
  };
  return mimeMap[format.toLowerCase()] || 'application/octet-stream';
}
