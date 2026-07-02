/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * FileValidator — Magic Byte 文件类型校验器
 *
 * 职责：入站时检测文件扩展名与内容头（Magic Bytes）是否匹配，
 *       防止文件扩展名伪造（如 .txt 伪装 .exe）。
 *
 * 使用方式：
 *   const validator = new FileValidator();
 *   const result = validator.validate(buffer, 'report.pdf');
 *   if (!result.valid) { console.warn(result.warning); }
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'services:file:validator',
  level: LogLevel.INFO,
});

export interface ValidationResult {
  /** 是否通过校验 */
  valid: boolean;
  /** 检测到的真实 MIME 类型 */
  detectedMimeType: string;
  /** 警告信息（扩展名与内容不匹配时） */
  warning?: string;
}

/**
 * Magic Byte 签名映射表
 *
 * 格式：扩展名 → [Magic Bytes 起始序列, MIME 类型]
 * 只检测常见高风险文件类型（可执行文件、压缩包等）
 */
const MAGIC_BYTES: Record<string, [number[], string]> = {
  // ─── 图片 ───
  png: [[0x89, 0x50, 0x4e, 0x47], 'image/png'],
  jpg: [[0xff, 0xd8, 0xff], 'image/jpeg'],
  jpeg: [[0xff, 0xd8, 0xff], 'image/jpeg'],
  gif: [[0x47, 0x49, 0x46, 0x38], 'image/gif'],
  webp: [[0x52, 0x49, 0x46, 0x46], 'image/webp'],
  bmp: [[0x42, 0x4d], 'image/bmp'],

  // ─── 音频 ───
  mp3: [[0xff, 0xfb], 'audio/mpeg'],
  ogg: [[0x4f, 0x67, 0x67, 0x53], 'audio/ogg'],
  wav: [[0x52, 0x49, 0x46, 0x46], 'audio/wav'],
  flac: [[0x66, 0x4c, 0x61, 0x43], 'audio/flac'],

  // ─── 视频 ───
  mp4: [[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], 'video/mp4'],
  webm: [[0x1a, 0x45, 0xdf, 0xa3], 'video/webm'],

  // ─── 文档 / 压缩包 ───
  pdf: [[0x25, 0x50, 0x44, 0x46], 'application/pdf'],
  zip: [[0x50, 0x4b, 0x03, 0x04], 'application/zip'],
  gz: [[0x1f, 0x8b], 'application/gzip'],
  rar: [[0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00], 'application/vnd.rar'],
  '7z': [[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], 'application/x-7z-compressed'],
  tar: [[0x75, 0x73, 0x74, 0x61, 0x72], 'application/x-tar'],

  // ─── 可执行文件（高风险） ───
  exe: [[0x4d, 0x5a], 'application/vnd.microsoft.portable-executable'],
  dll: [[0x4d, 0x5a], 'application/vnd.microsoft.portable-executable'],
  elf: [[0x7f, 0x45, 0x4c, 0x46], 'application/x-elf'],
  macho: [[0xfe, 0xed, 0xfa, 0xce], 'application/x-mach-binary'],
};

/**
 * 文件类型校验器
 */
export class FileValidator {
  /**
   * 校验文件扩展名与 Magic Bytes 是否匹配
   *
   * @param content 文件内容（至少前 16 字节）
   * @param fileName 原始文件名（用于提取扩展名）
   * @returns 校验结果
   */
  validate(content: Buffer, fileName: string): ValidationResult {
    const ext = this.extractExtension(fileName);

    if (!ext || !MAGIC_BYTES[ext]) {
      // 无扩展名或不在检测列表中，放行
      return { valid: true, detectedMimeType: 'unknown' };
    }

    const [magicBytes, expectedMime] = MAGIC_BYTES[ext];

    if (content.length < magicBytes.length) {
      return {
        valid: true,
        detectedMimeType: expectedMime,
        warning: `文件内容过短（${content.length}字节），无法完成 Magic Byte 校验`,
      };
    }

    const matches = magicBytes.every((byte, i) => content[i] === byte);

    if (matches) {
      return { valid: true, detectedMimeType: expectedMime };
    }

    logger.warn('文件扩展名与 Magic Bytes 不匹配', {
      fileName,
      expectedExt: ext,
      actualHeader: content
        .slice(0, Math.min(16, content.length))
        .toString('hex'),
    });

    return {
      valid: false,
      detectedMimeType: 'application/octet-stream',
      warning: `文件扩展名 ".${ext}" 与文件内容实际类型不匹配，可能存在扩展名伪造`,
    };
  }

  /**
   * 校验是否为可执行文件（高风险类型）
   *
   * 入站时拒绝可执行文件，防止安全风险
   *
   * @param content 文件内容
   * @returns 是否为可执行文件
   */
  isExecutable(content: Buffer): boolean {
    const highRiskExts = ['exe', 'dll', 'elf', 'macho'];

    for (const ext of highRiskExts) {
      const [magicBytes] = MAGIC_BYTES[ext];
      if (content.length >= magicBytes.length) {
        if (magicBytes.every((byte, i) => content[i] === byte)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 获取文件扩展名（小写）
   */
  private extractExtension(fileName: string): string | null {
    const idx = fileName.lastIndexOf('.');
    if (idx === -1 || idx === fileName.length - 1) return null;
    return fileName.slice(idx + 1).toLowerCase();
  }
}
