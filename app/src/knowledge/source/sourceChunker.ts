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
 * R4 原文分块构建（K4 剩余项：原文分块页码索引）
 *
 * 对 K1 抽取器产出的 ExtractedDocument（text + locators）按 locators 的
 * 行区间切分原文块：每个块严格落在单个 locator 范围内，因此可直接携带
 * page/section/tableId（PDF 页 / XLSX 表），检索命中即得到 doc.pdf#p.N 引用。
 *
 * - 纯文本类（md/txt）无 locators → 返回 []，维持既有 #L 行引用
 * - 跨 locator 行不产生块（页间分隔空行、未定位行自动跳过）
 */

import type { ExtractedDocument } from '../ingestion/extractors/types';

/** R4 原文块（页码/表格定位由 locators 反查填充） */
export interface SourceChunk {
  /** 源 raw 文件绝对路径 */
  rawPath: string;
  /** 块内序号（0 起，同一 raw 内自增） */
  seq: number;
  /** 页码（1 起；PDF 有，XLSX/DOCX 无） */
  page?: number;
  /** 页内唯一章节 / sheet 名 */
  section?: string;
  /** 表格定位（XLSX sheet 名） */
  tableId?: string;
  /** 块文本 */
  text: string;
}

/** 原文块构建选项（沿用 chunker 行窗口语义） */
export interface BuildSourceChunkOptions {
  /** 每个窗口行数，默认 60 */
  windowLines?: number;
  /** 连续窗口重叠行数，默认 12 */
  overlap?: number;
  /** 每个块最大字符数，默认 4000 */
  maxChunkChars?: number;
}

/** 默认最大块字符数（与 chunker DEFAULT_MAX_CHUNK_CHARS 一致） */
export const DEFAULT_SOURCE_CHUNK_CHARS = 4000;

/** 把单个 locator 覆盖的文本按行窗口切为若干 ≤maxChars 的文本片段 */
function splitLocatorBlock(
  block: string,
  windowLines: number,
  overlap: number,
  maxChunkChars: number
): string[] {
  const lines = block.split('\n');
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) return [];
  const stride = Math.max(1, windowLines - overlap);
  const parts: string[] = [];
  for (let start = 0; start < lines.length; start += stride) {
    const end = Math.min(lines.length, start + windowLines);
    const slice = lines.slice(start, end).join('\n').trim();
    if (slice.length === 0) {
      if (end >= lines.length) break;
      continue;
    }
    if (slice.length <= maxChunkChars) {
      parts.push(slice);
    } else {
      // 超长窗口：按行贪心切到 maxChunkChars 内，避免截断行内语义
      let current = '';
      for (const line of lines.slice(start, end)) {
        const candidate = current ? `${current}\n${line}` : line;
        if (current && candidate.length > maxChunkChars) {
          if (current.trim()) parts.push(current.trim());
          current = line;
        } else {
          current = candidate;
        }
      }
      if (current.trim()) parts.push(current.trim());
    }
    if (end >= lines.length) break;
  }
  return parts;
}

/**
 * 把抽取 IR 的原文按 locators 行区间切分 → 带页码定位的原文块。
 * locators 为空（文本类 / DOCX）返回 []。
 */
export function buildSourceChunks(
  ir: ExtractedDocument,
  opts: BuildSourceChunkOptions = {}
): SourceChunk[] {
  const windowLines = opts.windowLines ?? 60;
  const overlap = opts.overlap ?? 12;
  const maxChunkChars = opts.maxChunkChars ?? DEFAULT_SOURCE_CHUNK_CHARS;
  if (!ir || ir.locators.length === 0 || !ir.text) return [];

  const lines = ir.text.split(/\r?\n/);
  const chunks: SourceChunk[] = [];
  let seq = 0;

  for (const loc of ir.locators) {
    if (loc.lineStart < 1) continue;
    const start = loc.lineStart - 1;
    const end = Math.min(lines.length, loc.lineEnd);
    if (start >= end) continue;
    const block = lines.slice(start, end).join('\n');
    if (!block.trim()) continue;

    for (const part of splitLocatorBlock(
      block,
      windowLines,
      overlap,
      maxChunkChars
    )) {
      chunks.push({
        rawPath: ir.path,
        seq,
        ...(loc.page !== undefined ? { page: loc.page } : {}),
        ...(loc.section ? { section: loc.section } : {}),
        ...(loc.tableId ? { tableId: loc.tableId } : {}),
        text: part,
      });
      seq++;
    }
  }

  return chunks;
}
