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
 * D 阶段（2026-09-02，v4 §8）：会话摘要检索读取视图。
 *
 * `session/summary` 事件（D-1 摘要事件化产物）的解析/查询工具——事件日志本身
 * 全量保留，本模块仅提供"读取视图"（索引视图），不新增第二真相源：
 *  - parseSessionSummaries：events → 摘要记录（seq 升序）
 *  - findSummaryForSeq：给定被折叠事件 seq → 覆盖它的摘要（区间/源 seq 命中）
 *  - findSummaryByKeyword：按关键词（data.keywords 或正文包含）检索
 *
 * 与 session_lookup（原始记录按 seq 取回）互补：先摘要定位区间，再取回原文。
 */
import type { LiriEvent } from '../../chat/types/events';

/** 会话远期摘要记录（= session/summary 事件的解析视图） */
export interface SessionSummaryRecord {
  /** 摘要事件 seq（事件溯源内唯一标识） */
  seq: number;
  /** 事件时间戳（ms） */
  time: number;
  /** 摘要正文 */
  content: string;
  /** 检索关键词（轻量词频） */
  keywords?: string[];
  /** 投影 summary 消息 id（对齐 compaction done） */
  summaryMessageId?: string;
  /** 被折叠事件区间 */
  compactedRange?: { startSeq: number; endSeq: number };
  /** 被折叠的源消息事件 seq */
  sourceEventSeqs?: number[];
}

function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string');
  return out.length > 0 ? out : undefined;
}

function numArray(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is number => typeof x === 'number');
  return out.length > 0 ? out : undefined;
}

function range(v: unknown): { startSeq: number; endSeq: number } | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as { startSeq?: unknown; endSeq?: unknown };
  if (
    typeof r.startSeq !== 'number' ||
    typeof r.endSeq !== 'number' ||
    r.startSeq > r.endSeq
  ) {
    return undefined;
  }
  return { startSeq: r.startSeq, endSeq: r.endSeq };
}

/** 解析事件列表 → 摘要记录（跳过非 session/summary / 无正文行） */
export function parseSessionSummaries(
  events: LiriEvent[]
): SessionSummaryRecord[] {
  const out: SessionSummaryRecord[] = [];
  for (const ev of events) {
    if (ev.type !== 'session/summary') continue;
    const d = ev.data as Record<string, unknown>;
    if (typeof d.content !== 'string') continue;
    out.push({
      seq: ev.seq,
      time: ev.time,
      content: d.content,
      keywords: strArray(d.keywords),
      summaryMessageId:
        typeof d.summaryMessageId === 'string' ? d.summaryMessageId : undefined,
      compactedRange: range(d.compactedRange),
      sourceEventSeqs: numArray(d.sourceEventSeqs),
    });
  }
  // 防御：乱序输入按 seq 排序（事件溯源下 append-only 天然有序）
  out.sort((a, b) => a.seq - b.seq);
  return out;
}

/**
 * 给定被折叠的事件 seq → 覆盖它的摘要。
 * 命中优先级：compactedRange 含 seq → sourceEventSeqs 含 seq → 无区间时取
 * "seq ≤ 目标"的最近一份摘要（保守兜底：可能已进一步折叠）。
 * 未命中返回 null。
 */
export function findSummaryForSeq(
  summaries: SessionSummaryRecord[],
  seq: number
): SessionSummaryRecord | null {
  let fallback: SessionSummaryRecord | null = null;
  for (const s of summaries) {
    if (
      s.compactedRange &&
      seq >= s.compactedRange.startSeq &&
      seq <= s.compactedRange.endSeq
    ) {
      return s;
    }
    if (s.sourceEventSeqs?.includes(seq)) {
      return s;
    }
    if (s.seq <= seq) {
      fallback = s; // 最接近目标 seq 的（更早）摘要作为兜底
    }
  }
  return fallback;
}

/**
 * 按关键词检索摘要（keywords 元数据或正文包含，大小写不敏感）。
 * 返回与任一关键词命中（keywords 优先，正文次之），按 seq 升序。
 */
export function findSummaryByKeyword(
  summaries: SessionSummaryRecord[],
  keyword: string,
  limit = 5
): SessionSummaryRecord[] {
  if (!keyword) return [];
  const k = keyword.trim().toLowerCase();
  if (!k) return [];
  const out: SessionSummaryRecord[] = [];
  for (const s of summaries) {
    const kwHit = s.keywords?.some((w) => w.toLowerCase().includes(k)) ?? false;
    const textHit = kwHit || s.content.toLowerCase().includes(k);
    if (textHit) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
