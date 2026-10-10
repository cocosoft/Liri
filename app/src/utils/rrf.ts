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
 * 倒数排名融合（Reciprocal Rank Fusion, RRF）— 单一事实源
 *
 * 公式：`score(d) = Σ_i w_i / (k + rank_i(d) + 1)`（`rank` 从 0 起，`k` 默认 60）。
 * RRF 只对**排名**敏感、与各路评分量纲无关，故适合融合异质评分（如启发式关键词分
 * 与余弦相似度并存）。
 *
 * 零拷贝（延迟物化）：融合阶段只累计「键 → {累计分数, 条目引用}」，**不克隆/展开条目**；
 * 调用方可在截断（`limit`）后仅对 Top-K 物化，使对象分配量由 O(N) 收敛到 O(K)。
 *
 * 归一化约束（CS01）：本仓既有两处 RRF 相关实现曾各写一份，此后统一走本模块，
 * 禁止新增第三份。
 */

/** 融合条目：`item` 为原列表元素的**引用**（非克隆），由调用方决定何时物化 */
export interface RrfEntry<T> {
  /** 融合键（同一键跨列表视为同一文档） */
  key: string;
  /** 累计融合分数 */
  score: number;
  /** 承载该键的原始条目引用 */
  item: T;
}

export interface RrfOptions<T> {
  /** 待融合的多个有序列表（列表内部已按相关性降序，数组下标即排名） */
  lists: ReadonlyArray<readonly T[]>;
  /** 条目 → 融合键 */
  keyOf: (item: T) => string;
  /** 各路权重，缺省全为 1；长度不足时后续列表按 1 处理，为 0 表示该路不参与融合 */
  weights?: readonly number[];
  /** RRF 平滑常数 `k`，缺省 60 */
  k?: number;
  /** 只返回前 N 条（截断发生在物化之前） */
  limit?: number;
  /** 同键命中多路时 `item` 取哪一路引用：首次（first，缺省）或末次（last）出现的那路 */
  prefer?: 'first' | 'last';
}

/** 缺省平滑常数 */
const DEFAULT_RRF_K = 60;

/**
 * 倒数排名融合。
 *
 * 返回按 `score` 降序、同分按 `key` 升序排列的条目（确定性顺序）；`item` 为原始
 * 列表元素的引用，全程不做克隆。
 */
export function reciprocalRankFusion<T>(opts: RrfOptions<T>): RrfEntry<T>[] {
  const k = opts.k ?? DEFAULT_RRF_K;
  const prefer = opts.prefer ?? 'first';
  const { weights } = opts;

  // 累加器：键 → { 累计分数, 承载引用 }；仅存引用，避免 N 次对象展开
  const acc = new Map<string, { score: number; ref: T }>();

  for (let listIdx = 0; listIdx < opts.lists.length; listIdx++) {
    const weight = weights?.[listIdx] ?? 1;
    if (weight === 0) continue; // 权重为 0 ⇒ 该路不参与，避免仅属该路的条目以 0 分混入
    const list = opts.lists[listIdx]!;
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank]!;
      const key = opts.keyOf(item);
      const contribution = weight / (k + rank + 1);
      const existing = acc.get(key);
      if (existing) {
        existing.score += contribution;
        if (prefer === 'last') existing.ref = item;
      } else {
        acc.set(key, { score: contribution, ref: item });
      }
    }
  }

  const entries: RrfEntry<T>[] = [];
  for (const [key, { score, ref }] of acc) {
    entries.push({ key, score, item: ref });
  }

  entries.sort(
    (a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );

  return opts.limit === undefined ? entries : entries.slice(0, opts.limit);
}
