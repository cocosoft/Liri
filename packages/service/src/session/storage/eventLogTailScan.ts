// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 事件日志「尾部 seq 扫描」（A-6 兜底：流式主扫描失败时恢复真实 tailSeq）。
 *
 * 2026-11-26（长程真机取证，从 `EventLogStorage` 外移）：
 * - **单条事件可能远超 64KB** —— `context/model-input` 实测 107,993 字节（77 个工具 schema）。
 *   原实现固定读末尾 64KB ⇒ 窗口整段落在"同一行的中间"，首段 JSON 解析失败、窗口内也没有其它
 *   完整行 ⇒ `maxSeq` 恒为 0 ⇒ 与 `tailSeq` 比较判 `disk-behind`（"文件被外部截断"，与事实不符）：
 *   每次读事件都会**无谓作废快照 + 回退全量扫盘 + 刷 warn**（实测 `snapshotTailSeq === memoryTailSeq`
 *   仍报 `disk-behind` 共 9 条，其中 2 条发生在同一会话创建后的头两次读取）。
 * - 现：① `start > 0` 时窗口首段必然是被截断的半行，直接跳过；② 若窗口内**一条完整事件都没有**
 *   且窗口未覆盖整个文件 ⇒ 逐步扩大窗口（×4，最多到文件全长）后重试。
 */

import { promises as fs } from 'node:fs';

import type { LiriEvent } from '../types/events';
import { splitJsonLine } from './eventLineParse';

/** 尾部扫描的首个窗口（字节）；窗口内若没有任何完整事件 ⇒ 扩大窗口重试 */
export const TAIL_SCAN_WINDOW_BYTES = 64 * 1024;

/** 单行解析出 seq（损坏行按 `splitJsonLine` 恢复，2026-08-24 根因修复） */
function maxSeqInLine(line: string): number {
  try {
    const event = JSON.parse(line) as LiriEvent;
    return typeof event.seq === 'number' ? event.seq : 0;
  } catch {
    let maxSeq = 0;
    for (const obj of splitJsonLine(line)) {
      const seq = (obj as { seq?: unknown }).seq;
      if (typeof seq === 'number' && seq > maxSeq) maxSeq = seq;
    }
    return maxSeq;
  }
}

/**
 * 从"文件尾部若干字节"的文本里取最大 seq。
 *
 * @param skipFirstSegment 窗口起点不在文件头 ⇒ 首段是被截断的半行，**必须**跳过
 *（否则半行会走损坏行恢复，可能误取到不该采信的 seq）
 */
export function maxSeqInTailText(
  text: string,
  skipFirstSegment: boolean
): number {
  let maxSeq = 0;
  const segments = text.split('\n');
  for (let i = 0; i < segments.length; i += 1) {
    if (i === 0 && skipFirstSegment) continue;
    const line = segments[i]!;
    if (!line.trim()) continue;
    const seq = maxSeqInLine(line);
    if (seq > maxSeq) maxSeq = seq;
  }
  return maxSeq;
}

/**
 * 读 `filePath` 尾部并返回其中最大的 seq（无事件 / 空文件 ⇒ 0）。
 *
 * 窗口从 64KB 起；若整个窗口只覆盖一条超大事件的中间（解析不出任何事件），按 ×4 扩容重试。
 */
export async function scanTailMaxSeqFromFile(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath);
  if (stat.size === 0) return 0;
  let window = Math.min(TAIL_SCAN_WINDOW_BYTES, stat.size);
  for (;;) {
    const start = stat.size - window;
    const buf = Buffer.alloc(window);
    const fd = await fs.open(filePath, 'r');
    try {
      await fd.read(buf, 0, window, start);
    } finally {
      await fd.close();
    }
    const maxSeq = maxSeqInTailText(buf.toString('utf-8'), start > 0);
    if (maxSeq > 0 || start === 0) return maxSeq;
    // 窗口内没有完整事件（整段落在一条超大事件的中间）⇒ 扩大重试
    window = Math.min(window * 4, stat.size);
  }
}
