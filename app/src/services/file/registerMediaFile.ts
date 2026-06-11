/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * 媒体文件注册辅助函数
 *
 * AI 生成工具（Image/Video/MusicGenerateTool）完成生成后，
 * 将远程 URL 内容下载到本地 media/generated/ 目录并注册到 FileRegistry。
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { resolveMediaDir } from '@modules/core/paths';
import { FileRegistry } from './FileRegistry';
import { FileSource } from './types';
import type { MediaType } from './types';

/**
 * 下载远程媒体文件并注册到 FileRegistry
 *
 * @param url       远程媒体文件 URL
 * @param prompt    生成提示词（用于描述字段）
 * @param mediaType 媒体子类型（'image' | 'video' | 'music'）
 * @param format    文件扩展名（'png' | 'jpeg' | 'mp4' | 'mp3' 等）
 * @returns 注册结果，包含 fileId
 */
export async function registerGeneratedMedia(
  url: string,
  prompt: string,
  mediaType: MediaType,
  format: string
): Promise<{ fileId: string; savedPath: string } | null> {
  try {
    // Step 1: 下载远程文件
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const content = Buffer.from(arrayBuffer);

    // Step 2: 确定保存路径
    const mediaDir = resolveMediaDir();
    const subDir = join(mediaDir, 'generated', mediaType);
    await mkdir(subDir, { recursive: true });

    // Step 3: 注册到 FileRegistry（写入 media 分区）
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

    return { fileId: result.fileId, savedPath: result.savedPath };
  } catch {
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
