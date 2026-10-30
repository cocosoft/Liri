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
 * M8（2026-10-30，一致性核查）：消息投影（`messages.jsonl`）**分片**的唯一实现。
 *
 * 背景：单会话 `messages.jsonl` 实测最大 **17.2 MB**（49 文件共 127 MB、10 个 >5 MB）。
 * 分片布局（写入见 `FileSystemUnifiedStorage.persistMessagesRewrite`，一次性切分见
 * `scripts/split-session-messages.ts`）：
 *
 * ```
 * <sessionDir>/messages.0001.jsonl   ← 最旧
 * <sessionDir>/messages.0002.jsonl
 * <sessionDir>/messages.jsonl        ← **活动尾文件**（最新的最后一块）
 * ```
 *
 * 读侧（`FileSystemUnifiedStorage.loadMessages` / dream 采集器）=「分片升序 + 尾文件」拼接后
 * 复用既有反向去重（后写覆盖先写）⇒ 对上层完全透明；写路径只追加尾文件，零改动。
 */

import { readdir } from 'fs/promises';
import {
  LINE_CHUNK_MAX_BYTES,
  LINE_CHUNK_MAX_LINES,
  planLineChunks,
  type LineChunkPlan,
} from './lineChunkPlan.js';

/** 分片文件名字符模式（4 位以上零填充序号） */
export const MESSAGE_SEGMENT_RE = /^messages\.(\d{4,})\.jsonl$/;

/** 单个分片的字节上限（缺省 5 MB；与事件分片共用 `lineChunkPlan` 的唯一实现） */
export const MESSAGE_SEGMENT_MAX_BYTES = LINE_CHUNK_MAX_BYTES;

/** 单个分片的行数上限（缺省 1000 行） */
export const MESSAGE_SEGMENT_MAX_LINES = LINE_CHUNK_MAX_LINES;

/** 分片文件名（`messages.0001.jsonl`） */
export function segmentFileName(index: number): string {
  return `messages.${String(index).padStart(4, '0')}.jsonl`;
}

/**
 * 把「逐行字节数」切成若干块（贪心累积，受 `maxBytes` / `maxLines` 双约束）。
 *
 * **最后一块留在活动尾文件** ⇒ `segments = chunks.length - 1`。不修改入参。
 * 切块算法已归一化到 `./lineChunkPlan.ts`（A 事件分片共用）。
 */
export function planMessageSplit(
  lineBytes: readonly number[],
  options: { maxBytes?: number; maxLines?: number } = {}
): LineChunkPlan {
  return planLineChunks(lineBytes, options);
}

/** 列出会话目录内的分片（按序号升序；**不含**活动尾文件 `messages.jsonl`） */
export async function listMessageSegments(dirPath: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    // @ignore-catch 目录不存在（新建会话 / 已删除）⇒ 无分片
    return [];
  }
  return entries
    .filter((name) => MESSAGE_SEGMENT_RE.test(name))
    .sort(
      (a, b) =>
        Number(MESSAGE_SEGMENT_RE.exec(a)?.[1] ?? 0) -
        Number(MESSAGE_SEGMENT_RE.exec(b)?.[1] ?? 0)
    );
}
