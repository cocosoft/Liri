/**
 * MIT License
 * Copyright (c) 2026 190615273@qq.com
 *
 * 文件管理系统 — 统一文件命名工具
 *
 * 命名格式：f_{timestamp8}_{md5_8}_{sanitized_original_name}
 *   - f_          ：统一前缀，LLM 可识别为文件引用
 *   - timestamp8  ：Date.now() 的 base36 编码（毫秒级，约 6 年不重复前缀）
 *   - md5_8       ：MD5 前 8 位 hex，兼顾可读性和防冲突
 *   - sanitized   ：清理后的原始文件名（保留汉字等 Unicode）
 *
 * 示例：
 *   原始名：2026年度Q2工作报告-Final.pptx
 *   保存名：f_1a2b3c4d_e5f6a7b8_2026年度Q2工作报告-Final.pptx
 */

import { createHash } from 'crypto';
import { createReadStream } from 'fs';

/**
 * 生成统一保存文件名
 *
 * @param originalName - 原始文件名
 * @param md5 - 文件 MD5 值（32 位 hex）
 * @returns 统一格式的保存文件名
 */
export function generateSavedName(originalName: string, md5: string): string {
  const timestamp = Date.now().toString(36);
  const md5Prefix = md5.slice(0, 8);
  const sanitized = sanitizeFileName(originalName);

  return `f_${timestamp}_${md5Prefix}_${sanitized}`;
}

/**
 * 清理文件名中的非法字符
 *
 * 替换 Windows 路径非法字符：\ / : * ? " < > |
 * 保留汉字等有意义的 Unicode 字符
 *
 * @param name - 原始文件名
 * @returns 清理后的文件名
 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 计算文件内容的 MD5 值
 *
 * @param content - 文件内容（Buffer 或字符串）
 * @returns MD5 32 位 hex 字符串
 */
export function computeMd5(content: Buffer | string): string {
  return createHash('md5').update(content).digest('hex');
}

/**
 * 流式计算文件的 MD5 值（大文件使用）
 *
 * 通过 createReadStream 逐块读取文件，避免将大文件全部加载到内存中。
 * 适用于 > 100MB 的文件。
 *
 * @param filePath - 文件路径
 * @returns MD5 32 位 hex 字符串
 */
export function computeMd5Stream(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('md5');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });

    stream.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * 从保存名解析时间戳
 *
 * @param savedName - 统一格式的保存文件名
 * @returns 解码后的时间戳（毫秒），解析失败返回 null
 */
export function parseTimestampFromSavedName(savedName: string): number | null {
  const match = savedName.match(/^f_([a-z0-9]+)_/);
  if (!match) return null;
  return parseInt(match[1], 36);
}

/**
 * 从保存名解析 MD5 前缀
 *
 * @param savedName - 统一格式的保存文件名
 * @returns 8 位 MD5 前缀 hex 字符串，解析失败返回 null
 */
export function parseMd5FromSavedName(savedName: string): string | null {
  const match = savedName.match(/^f_[a-z0-9]+_([a-f0-9]{8})_/);
  if (!match) return null;
  return match[1];
}
