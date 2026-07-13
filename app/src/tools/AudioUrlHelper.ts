// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 音频 URL 固化工具
 * 从任意路径（磁盘路径、相对路径）生成规范的音频展示 URL
 */
const AUDIO_EXT_PATTERN = /\.(?:mp3|wav|ogg|flac|aac|m4a|wma|opus)$/i;

function extractFilename(input: string): string | null {
  const match = input.match(
    /[^\/\\]+\.(?:mp3|wav|ogg|flac|aac|m4a|wma|opus)$/i
  );
  return match ? match[0] : null;
}

const DISPLAY_PREFIX = '/v1/audio/static/';

export class AudioUrlHelper {
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

  static looksLikeAudioPath(input: string): boolean {
    return AUDIO_EXT_PATTERN.test(input) && input.length > 5;
  }
}
