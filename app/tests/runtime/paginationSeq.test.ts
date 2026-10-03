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
 * P1-6b（2026-09-27，Spec §10）：分页键归一化契约。
 *
 * 守护三件事：
 *  ① 缺失 `lastEventSeq` 者按数组顺序回填**单调**序号（量纲统一，杜绝"事件序号 vs epoch 毫秒"混比）；
 *  ② **不修改入参**（派生结果与缓存共享引用，就地改写会污染缓存）；
 *  ③ 归一化后「`before` 过滤 + 取尾部一页」可**连续翻页直到最早一条**；
 *     未归一化时原地打转（= 真机"点了没反应"的失败模式，作为**突变对照**）。
 */
import { describe, expect, test } from 'bun:test';
import { withPaginationSeq } from '../../src/runtime/api/paginationSeq';

interface Row {
  id: string;
  timestamp: number;
  lastEventSeq?: number;
}

/** 复刻后端 `_paginateMessages` 的键函数（`lastEventSeq ?? timestamp`，量纲混合） */
function backendKey(m: Row): number {
  return m.lastEventSeq ?? m.timestamp ?? 0;
}

/** 复刻后端 `_paginateMessages` 的查询语义：`before` 过滤 + 取尾部一页 */
function fetchPage(
  list: Row[],
  limit: number,
  before?: number
): { messages: Row[]; hasMore: boolean } {
  const filtered =
    before != null ? list.filter((m) => backendKey(m) <= before) : list;
  const hasMore = filtered.length > limit;
  return {
    messages: hasMore ? filtered.slice(filtered.length - limit) : filtered,
    hasMore,
  };
}

/** 复刻前端游标来源：**只读** `messages[0].lastEventSeq`（无 timestamp 兜底） */
function frontendCursor(page: Row[]): number | null {
  const first = page[0];
  return typeof first?.lastEventSeq === 'number' ? first.lastEventSeq : null;
}

/** 模拟"前端反复点加载更早"：返回可达条数与翻页轮数（`added === 0` 即停滞） */
function walk(list: Row[], limit: number): { seen: number; pages: number } {
  const seen = new Set<string>();
  let before: number | undefined;
  let pages = 0;
  for (;;) {
    const page = fetchPage(list, limit, before);
    if (page.messages.length === 0) break;
    const added = page.messages.filter((m) => !seen.has(m.id)).length;
    page.messages.forEach((m) => seen.add(m.id));
    pages += 1;
    if (added === 0) break; // 停滞：本页全是已加载条目
    if (!page.hasMore) break;
    const cursor = frontendCursor(page.messages);
    if (cursor == null) break; // 游标缺失 ⇒ 前端无法继续（真机失败点）
    before = cursor;
    if (pages > 100) break; // 防御：避免测试自身死循环
  }
  return { seen: seen.size, pages };
}

/**
 * 复刻真机数据形态：120 条中**每 10 条**才有真实 `lastEventSeq`（100…180，事件序号量纲），
 * 其余为 tool 类消息（无 seq、只有 epoch 毫秒 timestamp）；且**最后 30 条全无 seq**
 * —— 与真机"尾页 30 条 `lastEventSeq` 全缺"一致。
 */
const TOTAL = 120;
const LIMIT = 30;
function buildRows(): Row[] {
  return Array.from({ length: TOTAL }, (_, i) => ({
    id: `m${i}`,
    timestamp: 1_700_000_000_000 + i * 1000,
    ...(i % 10 === 0 && i < TOTAL - LIMIT ? { lastEventSeq: 100 + i } : {}),
  }));
}

describe('withPaginationSeq（P1-6b / Spec §10 分页键归一化）', () => {
  test('缺失者按数组顺序回填，键列单调非递减', () => {
    const normalized = withPaginationSeq([
      { id: 'a', timestamp: 1, lastEventSeq: 326 },
      { id: 'b', timestamp: 2 },
      { id: 'c', timestamp: 3 },
      { id: 'd', timestamp: 4, lastEventSeq: 580 },
      { id: 'e', timestamp: 5 },
    ]);
    expect(normalized.map((m) => m.lastEventSeq)).toEqual([
      326, 327, 328, 580, 581,
    ]);
  });

  test('不修改入参（回填仅落在浅拷贝上）', () => {
    const raw = [
      { id: 'a', timestamp: 1, lastEventSeq: 10 },
      { id: 'b', timestamp: 2 },
    ];
    const normalized = withPaginationSeq(raw);
    expect(normalized).not.toBe(raw);
    expect('lastEventSeq' in raw[1]).toBe(false);
    expect(raw[1]).toEqual({ id: 'b', timestamp: 2 });
  });

  test('无需回填时原样返回入参引用（零开销 / 幂等）', () => {
    const raw = [
      { id: 'a', timestamp: 1, lastEventSeq: 1 },
      { id: 'b', timestamp: 2, lastEventSeq: 2 },
    ];
    expect(withPaginationSeq(raw)).toBe(raw);
    expect(withPaginationSeq([])).toEqual([]);
  });

  test('归一化后每页首条恒有键（前端游标可用）', () => {
    const normalized = withPaginationSeq(buildRows());
    const tail = fetchPage(normalized, LIMIT);
    expect(tail.hasMore).toBe(true);
    expect(typeof frontendCursor(tail.messages)).toBe('number');
    // 键列非递减
    const keys = normalized.map(backendKey);
    expect(keys.every((k, i) => i === 0 || k >= keys[i - 1])).toBe(true);
  });

  test('突变对照：未归一化 ⇒ 原地打转（游标 null，仅到 30 条）', () => {
    const stalled = walk(buildRows(), LIMIT);
    expect(stalled.seen).toBe(LIMIT);
    expect(stalled.pages).toBe(1);
  });

  test('归一化后 ⇒ 连续翻页可达最早一条（覆盖全量）', () => {
    const walked = walk(withPaginationSeq(buildRows()), LIMIT);
    expect(walked.seen).toBe(TOTAL);
    expect(walked.pages).toBeGreaterThanOrEqual(TOTAL / LIMIT);
  });
});
