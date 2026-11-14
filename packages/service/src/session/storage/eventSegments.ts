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
 * A（2026-10-30）：事件流（`events.jsonl`）**按 seq 区间分片**的唯一实现。
 *
 * 背景：29 个 `events.jsonl` 共 196.8 MB（最大 25.4 MB / 43 052 行）。事件流是**真源**，
 * 单文件越大则「坏行定位 / 尾部修复 / 全量校验」的代价越高；M8 已用同一范式治理了
 * 消息投影，本模块把同一范式搬到事件流。
 *
 * 布局（**活动尾仍是 `events.jsonl`** ⇒ 追加路径零改动）：
 *
 * ```
 * <sessionDir>/events.0001.jsonl   ← 最旧（不可变）
 * <sessionDir>/events.0002.jsonl
 * <sessionDir>/events.jsonl        ← 活动尾（最新一块，继续 append）
 * ```
 *
 * **不变量**（破坏任一即拒绝切分）：
 *  ① **不重排 `seq`、不改一行内容**：分片只是把同一批行按顺序分配到多个文件，
 *     读侧「分片升序 + 尾文件」拼接后与切分前**逐字节相同**；
 *  ② `events.tail`（最大 seq）**保持不变** —— 最大 seq 恒落在活动尾文件；
 *  ③ 切分后**删除 `events.idx`**：索引条目的 `byteOffset` 是单文件绝对偏移，
 *     跨文件后全部失效（留着会让读侧 seek 到行中间）；由 append 在尾文件上按需重建；
 *  ④ 已分片的会话跳过（幂等）；分片文件**只读**，运行期只写尾文件。
 *
 * **读侧**：`EventLogStorage.read` / `buildSnapshot` / `copyPrefixTo` 按「分片升序 + 尾文件」
 * 顺序遍历；`getTailSeq` 只看尾文件（最大 seq 必在其内）。
 */

import { readdir } from 'fs/promises';
import { existsSync, openSync, readdirSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import {
  LINE_CHUNK_MAX_BYTES,
  LINE_CHUNK_MAX_LINES,
  planLineChunks,
  type LineChunkPlan,
} from './lineChunkPlan.js';

/** 事件分片文件名字符模式（4 位以上零填充序号） */
export const EVENT_SEGMENT_RE = /^events\.(\d{4,})\.jsonl$/;

/** 单块字节上限（与消息分片同口径） */
export const EVENT_SEGMENT_MAX_BYTES = LINE_CHUNK_MAX_BYTES;

/** 单块行数上限（与消息分片同口径） */
export const EVENT_SEGMENT_MAX_LINES = LINE_CHUNK_MAX_LINES;

/** 事件分片文件名（`events.0001.jsonl`） */
export function eventSegmentFileName(index: number): string {
  return `events.${String(index).padStart(4, '0')}.jsonl`;
}

/**
 * 按「逐行字节数」规划切块（**最后一块留在活动尾文件**）。
 *
 * @returns `segments = chunks.length - 1`（0 = 不切）
 */
export function planEventSplit(
  lineBytes: readonly number[],
  options: { maxBytes?: number; maxLines?: number } = {}
): LineChunkPlan {
  return planLineChunks(lineBytes, options);
}

/** 列出会话目录内的事件分片（按序号升序；**不含**活动尾文件 `events.jsonl`） */
export async function listEventSegments(dirPath: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    // @ignore-catch 目录不存在（新建 / 已删除会话）⇒ 无分片
    return [];
  }
  return entries
    .filter((name) => EVENT_SEGMENT_RE.test(name))
    .sort(
      (a, b) =>
        Number(EVENT_SEGMENT_RE.exec(a)?.[1] ?? 0) -
        Number(EVENT_SEGMENT_RE.exec(b)?.[1] ?? 0)
    );
}

/**
 * 同步版本（`EventLogStorage` 的同步判定路径用，如 `exists()`）。
 *
 * 与 `listEventSegments` 同一排序口径，只读目录名、不读文件内容。
 */
export function listEventSegmentsSync(dirPath: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    // @ignore-catch 同上
    return [];
  }
  return entries
    .filter((name) => EVENT_SEGMENT_RE.test(name))
    .sort(
      (a, b) =>
        Number(EVENT_SEGMENT_RE.exec(a)?.[1] ?? 0) -
        Number(EVENT_SEGMENT_RE.exec(b)?.[1] ?? 0)
    );
}

/**
 * 会话目录内是否存在事件数据（**尾文件或任一分片**）。
 *
 * 与 `EventLogStorage.exists()` 同口径：分片存在即代表"有历史事件"，
 * 即使尾文件被外部删除也不能当作空会话（否则会从 seq=1 重新分配，覆盖历史序号）。
 */
export function hasEventData(dirPath: string, tailPath: string): boolean {
  return existsSync(tailPath) || listEventSegmentsSync(dirPath).length > 0;
}

/** 会话目录内全部事件文件，按读顺序（分片升序 + 尾文件） */
export function eventFilePathsInOrder(
  dirPath: string,
  tailPath: string
): string[] {
  const segments = listEventSegmentsSync(dirPath).map((name) =>
    join(dirPath, name)
  );
  return existsSync(tailPath) ? [...segments, tailPath] : segments;
}

/** 尾文件首行探测的读取窗口（首条事件远小于此；超出即视为"不可解析"，回退逐文件扫描） */
const TAIL_FIRST_SEQ_PROBE_BYTES = 8 * 1024;

/**
 * 事件行的 UTF-8 字节数（**含行尾 `\n`**）。
 *
 * 口径必须与 append 侧折叠 `events.idx` 同源（G-4：seek 偏移不允许近似）：
 * append 以 `JSON.stringify(event) + '\n'` 落盘，故行字节 = JSON 文本字节数 + 1。
 * readline 已剥离行尾换行（`crlfDelay: Infinity` 下 `'\r\n'` 亦整体剥离），
 * 故读侧对 `line` 再 +1 即可与写侧一致。
 *
 * 历史 CRLF 文件会**少算** 1 字节/行（偏移偏小）——由宿主的 `isLineStart`
 * 行边界校验拦住并回退全扫（只慢不错）。
 */
export function eventLineBytes(jsonText: string): number {
  return Buffer.byteLength(jsonText, 'utf-8') + 1;
}

/**
 * 按「分片升序 + 尾文件」逐行产出事件行，并给出该行在**所属文件**内的起始 UTF-8 字节偏移
 * （续页锚点用；跨文件时偏移不通用，故一并给出 `file`）。
 *
 * `startFile` / `startOffset` 只对**一个**文件生效（idx 与锚点都只对活动尾文件有意义）。
 * 只给 `startFile` 而**不给** `startOffset` ⇒ 该文件也从头读（"全量扫描"语义，调用方
 * 不传 options 时同样从头读）。
 */
export async function* iterateEventFiles(
  files: readonly string[],
  open: (file: string, start?: number) => AsyncIterable<string>,
  options: { startFile?: string; startOffset?: number } = {}
): AsyncGenerator<{ line: string; lineStart: number; file: string }> {
  for (const file of files) {
    const seek =
      options.startFile === file && options.startOffset !== undefined;
    const start = seek ? (options.startOffset as number) : 0;
    const rl = seek ? open(file, start) : open(file);
    let bytes = start;
    for await (const line of rl) {
      const lineStart = bytes;
      bytes += eventLineBytes(line);
      yield { line, lineStart, file };
    }
  }
}

/**
 * 读取活动尾文件的**首条事件 seq**（分片布局下用于判断 fromSeq 是否落在尾文件内）。
 *
 * 只读文件头 ≤8KB；`events.jsonl` append-only ⇒ 首 seq 恒定。
 * @returns `0` = 文件不存在 / 为空 / 首行不可解析（调用方回退逐文件扫描，只慢不错）
 */
export function readTailFirstSeq(tailPath: string): number {
  let fd: number;
  try {
    fd = openSync(tailPath, 'r');
  } catch {
    // @ignore-catch 文件不存在 / 无权限 ⇒ 视为未知
    return 0;
  }
  try {
    const buf = Buffer.alloc(TAIL_FIRST_SEQ_PROBE_BYTES);
    const read = readSync(fd, buf, 0, buf.length, 0);
    for (const line of buf.subarray(0, read).toString('utf-8').split('\n')) {
      if (!line.trim()) continue;
      const match = line.match(/"seq":(\d+)/);
      const seq = match ? Number.parseInt(match[1], 10) : Number.NaN;
      return Number.isFinite(seq) && seq > 0 ? seq : 0;
    }
    return 0;
  } catch {
    // @ignore-catch 读失败 ⇒ 未知
    return 0;
  } finally {
    closeSync(fd);
  }
}
