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
 * 事件行解析纯函数（损坏行拆分恢复 + 快照过滤）
 *
 * 由 `EventLogStorage.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §37）：两个纯函数被宿主多处
 * （读路径 / 快照）与 **repair 簇**共用 ⇒ 下沉为独立模块以打破「repair 需 import 宿主」的环。
 *
 * ⚠️ **只搬不改**：逻辑逐字保留。宿主 `EventLogStorage` 对二者**再导出**，
 * 以保持既有 import 路径（`app/scripts/verify-derive.ts` 等）不变。
 */

import type { LiriEvent, LiriEventType } from '@modules/session/types/events';

// ─── 损坏行拆分恢复（2026-08-24 根因修复）───────────────────────────────────

/**
 * 从可能损坏的 JSONL 行中提取完整的 JSON 对象数组
 *
 * 背景（2026-08-24 根因修复）：跨实例并发 append（多进程/多实例各自持有
 * per-session EventLogStorage，mutex 互不共享）可能把多个事件拼接/截断进同一
 * 物理行，如 {"type":"assistant/text",...,"content":"x{"type":"user/message",...}}
 * ——整行 JSON.parse 失败导致事件丢失、tailSeq 少算、投影兜底消息乱序置顶。
 *
 * 策略：
 *   - 快路径：整行即完整 JSON，直接返回（正常行零开销）
 *   - 慢路径：跳过行首无法解析的截断前缀，从每个 '{' 起点贪心匹配第一个
 *     闭合 '}' 并尝试解析；成功后提取并继续解析剩余部分（多段恢复）。
 *     行内字符串中的 '}' 不会误判边界（未闭合字符串 JSON.parse 天然失败）。
 *
 * 防护：超大损坏行（> 64KB）与候选起点过多（> 64）时放弃恢复，防 O(n²)
 * 解析拖垮读取路径（损坏行为罕见路径，正常行不受影响）。
 */
export function splitJsonLine(line: string): unknown[] {
  const rest = line.trim();
  if (!rest) return [];
  // 快路径：整行即为完整 JSON
  try {
    return [JSON.parse(rest)];
  } catch {
    // 进入慢路径
  }
  const MAX_REPAIR_LINE_LEN = 64 * 1024;
  if (rest.length > MAX_REPAIR_LINE_LEN) return [];
  const results: unknown[] = [];
  let cursor = 0;
  let guard = 0;
  const MAX_CANDIDATES = 64;
  while (cursor < rest.length && guard++ < MAX_CANDIDATES) {
    let recovered: unknown | undefined;
    let consumedTo = -1;
    for (let start = cursor; start < rest.length; start++) {
      if (rest[start] !== '{') continue;
      for (let end = start + 1; end < rest.length; end++) {
        if (rest[end] !== '}') continue;
        const candidate = rest.slice(start, end + 1);
        try {
          recovered = JSON.parse(candidate);
          consumedTo = end;
          break;
        } catch {
          // 边界未到（含嵌套 '}' 或字符串内 '}'），继续找下一个 '}'
        }
      }
      if (recovered !== undefined) break;
    }
    if (recovered === undefined || consumedTo < 0) break;
    results.push(recovered);
    cursor = consumedTo + 1;
  }
  return results;
}

/**
 * P1-2（2026-08-30）：从事件快照内存过滤（对齐 read() 的过滤语义）
 *
 * 快照内事件已深冻结（D1），直接共享引用；返回新数组（浅拷贝事件引用），
 * 调用方对其排序/修改不影响缓存。顺序保持快照 seq 升序。
 */
export function filterSnapshotEvents(
  snapshot: LiriEvent[],
  q: {
    fromSeq: number;
    toSeq: number;
    types?: LiriEventType[];
    excludeTypes?: LiriEventType[];
    limit: number;
  }
): LiriEvent[] {
  const results: LiriEvent[] = [];
  for (const ev of snapshot) {
    if (results.length >= q.limit) break;
    if (ev.seq < q.fromSeq || ev.seq > q.toSeq) continue;
    if (q.types && !q.types.includes(ev.type)) continue;
    if (q.excludeTypes && q.excludeTypes.includes(ev.type)) continue;
    results.push(ev);
  }
  return results;
}
