// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 视频 URL 固化工具
 * 从任意路径（磁盘路径、相对路径）生成规范的视频展示 URL
 */
const VIDEO_EXT_PATTERN = /\.(?:mp4|webm|mov|avi|mkv|ogv)$/i;

function extractFilename(input: string): string | null {
  const match = input.match(/[^\/\\]+\.(?:mp4|webm|mov|avi|mkv|ogv)$/i);
  return match ? match[0] : null;
}

const DISPLAY_PREFIX = '/v1/videos/static/';

export class VideoUrlHelper {
  static toDisplayUrl(input: string): string {
    const filename = extractFilename(input);
    if (!filename) return input;
    return `${DISPLAY_PREFIX}${filename}`;
  }

  static toDisplayUrlOrNull(input: string): string | null {
    const filename = extractFilename(input);
    if (!filename) return null;
    return `${DISPLAY_PREFIX}${filename}`;
  }

  static extractFilename(input: string): string | null {
    return extractFilename(input);
  }

  static looksLikeVideoPath(input: string): boolean {
    return VIDEO_EXT_PATTERN.test(input) && input.length > 5;
  }
}