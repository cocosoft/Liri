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
 * P1-6b（2026-09-27，Spec §10）：分页键归一化 —— 为缺失 `lastEventSeq` 的条目按
 * **最终数组顺序**回填单调序号。
 *
 * 背景（真机取证，会话 `session_mtw7nr44dkgini0x0a5`）：全量 709 条中**仅 16 条**带
 * `lastEventSeq`（事件序号，本例 326…5377），其余缺失者的分页键退化为 `timestamp`
 * （epoch 毫秒，1.7e12 量级）。两种量纲混比会让 `key(m) <= before` 过滤**恒真**
 * （每页都返回同一批尾部消息、`hasMore` 恒 true，前端 id 去重后"点了没反应"）；
 * 且前端游标只读 `messages[0].lastEventSeq` ⇒ 尾页首条缺该字段时游标为 `null`，
 * 「加载更早」彻底不可用。
 *
 * 修法：按传入数组的**权威顺序**（派生/投影顺序）为缺失者赋 `runningMax + 1`，
 * 使整列键非递减；每页首条因此恒有键，前端游标恢复可用。
 *
 * **不修改入参**：仅对需要回填的条目返回浅拷贝（派生结果可能来自缓存、与调用方共享
 * 引用，就地改写会污染缓存）；无需回填时原样返回入参（零额外开销）。
 *
 * @param list 已按权威顺序排好的消息列表
 * @returns 键列非递减的列表（可能为原引用）
 */
export function withPaginationSeq<T extends { lastEventSeq?: number }>(
  list: T[]
): T[] {
  let runningMax = 0;
  let changed = false;
  const out = list.map((m) => {
    const seq =
      typeof m.lastEventSeq === 'number' && Number.isFinite(m.lastEventSeq)
        ? m.lastEventSeq
        : null;
    if (seq == null) {
      changed = true;
      // 严格大于前驱（含真实键的最大值）⇒ 不制造逆序，也不与真实序号相等
      runningMax += 1;
      return { ...m, lastEventSeq: runningMax };
    }
    if (seq > runningMax) runningMax = seq;
    return m;
  });
  return changed ? out : list;
}
