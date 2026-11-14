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
 * 逐行切块的**唯一实现**（M8 消息分片与 A 事件分片共用，CS01 归一化）。
 *
 * 输入是每行的字节数（含行尾 `\n`），输出是「贪心累积 + 双约束（字节 / 行数）」的块区间；
 * **最后一块留在活动尾文件** ⇒ `segments = chunks.length - 1`。
 */

/** 默认单块字节上限（5 MB）——消息分片与事件分片同口径 */
export const LINE_CHUNK_MAX_BYTES = 5 * 1024 * 1024;

/** 默认单块行数上限（1000 行） */
export const LINE_CHUNK_MAX_LINES = 1000;

/** 切块计划 */
export interface LineChunkPlan {
  /** 每块的半开区间 `[from, to)`，按文件顺序 */
  chunks: Array<{ from: number; to: number }>;
  /** 切出的分片数（不含活动尾文件） */
  segments: number;
}

/**
 * 把「逐行字节数」切成若干块（不修改入参）。
 *
 * 双约束任一命中即切：`bytes + size > maxBytes` 或 `lines >= maxLines`。
 * 空输入 ⇒ `{ chunks: [], segments: 0 }`；单块 ⇒ `segments: 0`（不切）。
 */
export function planLineChunks(
  lineBytes: readonly number[],
  options: { maxBytes?: number; maxLines?: number } = {}
): LineChunkPlan {
  const maxBytes = Math.max(1, options.maxBytes ?? LINE_CHUNK_MAX_BYTES);
  const maxLines = Math.max(1, options.maxLines ?? LINE_CHUNK_MAX_LINES);
  const chunks: Array<{ from: number; to: number }> = [];
  let from = 0;
  let bytes = 0;
  let lines = 0;
  for (let i = 0; i < lineBytes.length; i++) {
    const size = lineBytes[i];
    if (lines > 0 && (bytes + size > maxBytes || lines >= maxLines)) {
      chunks.push({ from, to: i });
      from = i;
      bytes = 0;
      lines = 0;
    }
    bytes += size;
    lines += 1;
  }
  if (lines > 0) chunks.push({ from, to: lineBytes.length });
  return { chunks, segments: Math.max(0, chunks.length - 1) };
}
