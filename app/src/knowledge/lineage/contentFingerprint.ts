// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * K5 内容指纹 — contentFingerprint
 *
 * 稳定性哈希（sha1）：
 *   - 编译输入 raw 的字节摘要存 compile-state，用于"内容变但 mtime 未变"检测
 *   - 纯文本摘要供单元与既有调用方使用
 */

import { createHash } from 'crypto';
import { readFile } from 'fs/promises';

/** sha1 hex（稳定，非安全用途） */
export function hashBytes(input: Buffer): string {
  return createHash('sha1').update(input).digest('hex');
}

/** 文本摘要（utf-8） */
export function computeTextDigest(text: string): string {
  return hashBytes(Buffer.from(text, 'utf-8'));
}

/** 读取文件字节并摘要 */
export async function computeFileDigest(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return hashBytes(buf);
}

/**
 * 内容指纹重编译决策（K5.1，纯函数便于单测）
 * @param prevDigest compile-state 中上次编译的 digest；undefined 表示无历史（无法比较 → false）
 * @param currentDigest 本次读到的内容摘要
 * @returns true = 需要重编译
 */
export function shouldRecompileByFingerprint(
  prevDigest: string | undefined,
  currentDigest: string
): boolean {
  if (!prevDigest) return false;
  return prevDigest !== currentDigest;
}
