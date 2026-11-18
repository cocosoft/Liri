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
 * N-50（2026-09-20）：**已删除轮次的事件 seq 墓碑** —— 纯函数（无 IO，便于单测）。
 *
 * 背景：助手/工具消息由**事件派生**（`EventMessageDeriver` 以 `agg.maxChunkSeq` 为基线），
 * 仅删除投影（`messages.jsonl`）不足以移除它们 —— 读时会被事件重新派生出来，于是删掉提问后
 * 回复变成**孤儿**（实测证据见台账 N-50）。事件日志是不可变溯源，重写会留下 seq 空洞，故：
 * 删除时把该轮的 `[startSeq, endSeq]` 记入会话元数据墓碑，**读取时按 `lastEventSeq` 过滤**；
 * 投影侧同时删除整轮条目，作为投影兜底路径的第二条防线。
 *
 * 依赖前置：事件派生读路径必须真实生效（**N-52** 修复后成立）—— 生效前墓碑对读路径无影响
 * （过滤键取不到值），故本模块与 N-52 修复**同批落地**。详见
 * `.trae/specs/event-derivation-read-path-rootfix.md`。
 *
 * 区间语义：**闭区间**（含两端）；`endSeq === null` 表示"到会话末尾"。
 */
export interface DeletedSeqRange {
  startSeq: number;
  endSeq: number | null;
}

/** `seq` 是否落在任一墓碑区间内（`seq` 非有限数字时视为不落在 —— 不误删） */
export function isSeqInDeletedRanges(
  seq: unknown,
  ranges: readonly DeletedSeqRange[] | undefined
): boolean {
  if (!ranges || ranges.length === 0) return false;
  if (typeof seq !== 'number' || !Number.isFinite(seq)) return false;
  return ranges.some(
    (r) => seq >= r.startSeq && (r.endSeq === null || seq <= r.endSeq)
  );
}

/**
 * 合并新增墓碑区间：与既有区间重叠/相邻时合并，返回**按 startSeq 升序**的新数组。
 * 不做原地修改（调用方可能持有旧引用）。
 */
export function addDeletedRange(
  ranges: readonly DeletedSeqRange[] | undefined,
  next: DeletedSeqRange
): DeletedSeqRange[] {
  const all = [...(ranges ?? []), next].sort((a, b) => a.startSeq - b.startSeq);
  const merged: DeletedSeqRange[] = [];
  for (const r of all) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...r });
      continue;
    }
    // 相邻（last.endSeq + 1 === r.startSeq）或重叠 ⇒ 合并
    const touches = last.endSeq === null || r.startSeq <= last.endSeq + 1;
    if (!touches) {
      merged.push({ ...r });
      continue;
    }
    // 合并后上界取"更晚"的一个；任一方为 null（到末尾）则结果为 null
    last.endSeq =
      last.endSeq === null || r.endSeq === null
        ? null
        : Math.max(last.endSeq, r.endSeq);
  }
  return merged;
}
