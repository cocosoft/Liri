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
 * N-50（2026-09-20）：删除轮次"事件 seq 墓碑"的纯函数契约（与 N-52 修复同批落地）。
 *
 * 背景：助手/工具消息由事件派生，仅删投影不足以移除它们（读时会被事件重新派生）；
 * 事件日志不可重写（会留 seq 空洞），故删除时记录该轮 `[startSeq, endSeq]` 区间，
 * 读取时按派生消息的 `lastEventSeq` 过滤。本组测试守护区间语义与合并行为。
 */
import { describe, expect, test } from 'bun:test';
import {
  addDeletedRange,
  isSeqInDeletedRanges,
  type DeletedSeqRange,
} from '../../src/session/storage/deletedRanges';

describe('N-50 删除墓碑区间', () => {
  test('isSeqInDeletedRanges：闭区间命中，endSeq=null 表示到末尾', () => {
    const ranges: DeletedSeqRange[] = [
      { startSeq: 10, endSeq: 20 },
      { startSeq: 40, endSeq: null },
    ];
    expect(isSeqInDeletedRanges(9, ranges)).toBe(false);
    expect(isSeqInDeletedRanges(10, ranges)).toBe(true);
    expect(isSeqInDeletedRanges(20, ranges)).toBe(true);
    expect(isSeqInDeletedRanges(21, ranges)).toBe(false);
    expect(isSeqInDeletedRanges(39, ranges)).toBe(false);
    expect(isSeqInDeletedRanges(40, ranges)).toBe(true);
    expect(isSeqInDeletedRanges(99999, ranges)).toBe(true);
  });

  test('isSeqInDeletedRanges：无墓碑或非有限数字 seq 不误删', () => {
    expect(isSeqInDeletedRanges(5, undefined)).toBe(false);
    expect(isSeqInDeletedRanges(5, [])).toBe(false);
    const ranges: DeletedSeqRange[] = [{ startSeq: 1, endSeq: null }];
    expect(isSeqInDeletedRanges(undefined, ranges)).toBe(false);
    expect(isSeqInDeletedRanges(Number.NaN, ranges)).toBe(false);
    expect(isSeqInDeletedRanges('5', ranges)).toBe(false);
  });

  test('addDeletedRange：重叠/相邻合并、保持升序、不改动入参数组', () => {
    const base: DeletedSeqRange[] = [{ startSeq: 10, endSeq: 20 }];
    // 相邻（20 + 1 === 21）⇒ 合并
    const merged = addDeletedRange(base, { startSeq: 21, endSeq: 30 });
    expect(merged).toEqual([{ startSeq: 10, endSeq: 30 }]);
    expect(base).toEqual([{ startSeq: 10, endSeq: 20 }]);

    // 重叠（5..12 覆盖 10..30 的左端）⇒ 合并为 5..30
    const merged2 = addDeletedRange(merged, { startSeq: 5, endSeq: 12 });
    expect(merged2).toEqual([{ startSeq: 5, endSeq: 30 }]);

    // 不相邻 ⇒ 两条区间，按 startSeq 升序
    const merged3 = addDeletedRange(merged2, { startSeq: 100, endSeq: 120 });
    expect(merged3).toEqual([
      { startSeq: 5, endSeq: 30 },
      { startSeq: 100, endSeq: 120 },
    ]);
  });

  test('addDeletedRange：任一方到末尾 ⇒ 合并结果到末尾', () => {
    expect(
      addDeletedRange([{ startSeq: 1, endSeq: 10 }], {
        startSeq: 11,
        endSeq: null,
      })
    ).toEqual([{ startSeq: 1, endSeq: null }]);
    expect(
      addDeletedRange([{ startSeq: 5, endSeq: null }], {
        startSeq: 8,
        endSeq: 12,
      })
    ).toEqual([{ startSeq: 5, endSeq: null }]);
  });
});
