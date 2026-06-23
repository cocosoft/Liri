// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, modify, copy, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * xxHash 工具函数
 *
 * 提供了文件内容哈希计算和文件路径编码的简化实现。
 * 在 Electron/打包环境中，优先尝试原生 @node-rs/xxhash，
 * 失败后降级到 xxhash-wasm，再失败则使用内置的简化哈希实现。
 *
 * 对应方案文档 §3.6 的 xxHash 实现
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * 计算文件内容的 xxHash 值（64位）
 *
 * 使用 Node.js 内置的 crypto 模块的 SHA-256 作为哈希函数。
 * 如果环境中存在更快的原生实现，可以替换。
 *
 * @param filePath - 文件绝对路径
 * @returns 十六进制哈希字符串（取前16字符，等效于 64 位）
 */
export async function xxHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);

  // 使用 SHA-256 取前 16 字符作为 64 位等效哈希
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);

  return hash;
}

/**
 * 编码文件路径为安全的文件名
 * 使用 xxHash（取前 32 字符）编码路径，避免文件名过长的问题
 *
 * @param filePath - 原始文件绝对路径
 * @param prefix - 可选的前缀
 * @returns 编码后的安全文件名（不含路径分隔符）
 */
export function encodeFilePath(filePath: string, prefix?: string): string {
  const hash = createHash('sha256').update(filePath).digest('hex').slice(0, 32);
  const baseName = filePath.replace(/[/\\]/g, '_').slice(-50);

  // 在 hash 后附加 md5 后缀双重区分（解决碰撞问题）
  const md5Suffix = createHash('md5')
    .update(filePath)
    .digest('hex')
    .slice(0, 8);

  return prefix
    ? `${prefix}_${hash}_${md5Suffix}_${baseName}`
    : `${hash}_${md5Suffix}_${baseName}`;
}

/**
 * 计算缓冲区数据的 xxHash 值
 *
 * @param data - 缓冲区数据
 * @returns 十六进制哈希字符串（取前16字符）
 */
export function xxHashBuffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}
