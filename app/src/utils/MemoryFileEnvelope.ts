// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
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
 * MemoryFileEnvelope — 记忆 JSON 文件信封格式工具（统一入口）
 *
 * 对标 dsh 存储工程化：gzip 压缩 + sha256 checksum 校验 + 格式版本。
 * 供所有记忆 JSON 文件（KV 记忆 / 检索索引 / 关系图谱）复用，避免重复实现。
 *
 * 信封格式：
 *   { version: 1, checksum: sha256(payload), compressed: 'gzip'|'none', data }
 *   - payload 超 COMPRESS_THRESHOLD 自动 gzip（小文件保持明文避免 base64 膨胀）
 *   - 解码区分三种状态：envelope（校验通过）/ legacy（旧明文格式）/ corrupt（损坏）
 */

import { createHash } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';

/** 信封格式版本 */
export const MEMORY_ENVELOPE_VERSION = 1;
/** 压缩阈值：payload 超过该字节数才 gzip 压缩 */
export const COMPRESS_THRESHOLD = 1024;

/** 记忆文件信封格式 */
export interface MemoryEnvelope {
  version: number;
  /** payload 的 sha256 校验和（防损坏检测） */
  checksum: string;
  /** 压缩方式：'gzip' | 'none' */
  compressed: 'gzip' | 'none';
  /** 内容：明文 JSON 字符串，或 gzip 后的 base64 */
  data: string;
}

/** 解码结果 */
export type EnvelopeDecodeResult =
  | { status: 'envelope'; payload: string }
  | { status: 'legacy'; payload: string }
  | { status: 'corrupt' };

/**
 * 编码 payload 为信封 JSON 字符串。
 * @param payload 明文 JSON 字符串
 * @returns 信封 JSON 字符串
 */
export function encodePayload(payload: string): string {
  const shouldCompress = payload.length > COMPRESS_THRESHOLD;
  const envelope: MemoryEnvelope = {
    version: MEMORY_ENVELOPE_VERSION,
    compressed: shouldCompress ? 'gzip' : 'none',
    checksum: createHash('sha256').update(payload, 'utf-8').digest('hex'),
    data: shouldCompress
      ? gzipSync(Buffer.from(payload, 'utf-8')).toString('base64')
      : payload,
  };
  return JSON.stringify(envelope);
}

/**
 * 解码信封 JSON：校验 checksum → 解压。
 * 三态：
 *   - 'envelope'：信封格式且校验通过（payload 已解压）
 *   - 'legacy'：旧明文 JSON（无信封字段），payload = 原始内容
 *   - 'corrupt'：信封格式但 checksum 不匹配 / 解压失败（损坏）
 */
export function decodePayload(raw: string): EnvelopeDecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'legacy', payload: raw };
  }

  // 非信封（无 checksum/data 字段）→ 旧明文格式
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('checksum' in parsed) ||
    !('data' in parsed)
  ) {
    return { status: 'legacy', payload: raw };
  }

  const envelope = parsed as MemoryEnvelope;
  try {
    const payload =
      envelope.compressed === 'gzip'
        ? gunzipSync(Buffer.from(envelope.data, 'base64')).toString('utf-8')
        : envelope.data;
    const actualChecksum = createHash('sha256')
      .update(payload, 'utf-8')
      .digest('hex');
    if (actualChecksum !== envelope.checksum) {
      return { status: 'corrupt' };
    }
    return { status: 'envelope', payload };
  } catch {
    return { status: 'corrupt' };
  }
}
