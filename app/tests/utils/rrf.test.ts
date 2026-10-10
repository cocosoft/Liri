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
 * 倒数排名融合（RRF）单一事实源单测。
 *
 * 锁定：公式 `score = Σ w_i / (k + rank_i + 1)`、缺省 `k=60`、权重、
 * `prefer` 引用选择、`limit` 截断、确定性排序（score 降序 + key 升序）、
 * **零拷贝**（`item` 为原引用）、`rrfMaxScore` 归一化上界 `(0, 1]`。
 */
import { describe, expect, it } from 'bun:test';
import { reciprocalRankFusion, rrfMaxScore } from '../../src/utils/rrf';

/** 构造带 `id` 的简单条目 */
const item = (id: string): { id: string } => ({ id });

describe('reciprocalRankFusion：单列表与缺省参数', () => {
  it('缺省 k=60 ⇒ rank0 得 1/61、rank1 得 1/62，顺序保持', () => {
    const out = reciprocalRankFusion({
      lists: [[item('a'), item('b')]],
      keyOf: (x) => x.id,
    });
    expect(out.map((e) => e.key)).toEqual(['a', 'b']);
    expect(out[0]!.score).toBeCloseTo(1 / 61, 12);
    expect(out[1]!.score).toBeCloseTo(1 / 62, 12);
  });

  it('自定义 k ⇒ 分母随之位移', () => {
    const out = reciprocalRankFusion({
      lists: [[item('a')]],
      keyOf: (x) => x.id,
      k: 9,
    });
    expect(out[0]!.score).toBeCloseTo(1 / 10, 12);
  });

  it('空列表集合 / 空列表 ⇒ 空结果', () => {
    const keyOf = (x: { id: string }): string => x.id;
    expect(reciprocalRankFusion({ lists: [], keyOf })).toEqual([]);
    expect(reciprocalRankFusion({ lists: [[]], keyOf })).toEqual([]);
  });
});

describe('reciprocalRankFusion：跨列表融合', () => {
  it('同键命中两路 ⇒ 分数相加', () => {
    const out = reciprocalRankFusion({
      lists: [[item('a'), item('b')], [item('b')]],
      keyOf: (x) => x.id,
    });
    // b 在两路分别 rank1 / rank0 ⇒ 分数为 1/62 + 1/61 > a 的 1/61
    expect(out.find((e) => e.key === 'b')!.score).toBeCloseTo(
      1 / 62 + 1 / 61,
      12
    );
    expect(out.map((e) => e.key)).toEqual(['b', 'a']);
  });

  it('权重按列表逐路生效', () => {
    const out = reciprocalRankFusion({
      lists: [[item('a')], [item('b')]],
      keyOf: (x) => x.id,
      weights: [2, 0.5],
    });
    expect(out.find((e) => e.key === 'a')!.score).toBeCloseTo(2 / 61, 12);
    expect(out.find((e) => e.key === 'b')!.score).toBeCloseTo(0.5 / 61, 12);
  });

  it('权重为 0 ⇒ 该路不参与（条目不以 0 分混入）', () => {
    const out = reciprocalRankFusion({
      lists: [[item('a')], [item('only-second')]],
      keyOf: (x) => x.id,
      weights: [1, 0],
    });
    expect(out.map((e) => e.key)).toEqual(['a']);
  });

  it('权重数组长度不足 ⇒ 后续列表按 1 处理', () => {
    const out = reciprocalRankFusion({
      lists: [[item('a')], [item('b')]],
      keyOf: (x) => x.id,
      weights: [2],
    });
    expect(out.find((e) => e.key === 'b')!.score).toBeCloseTo(1 / 61, 12);
  });
});

describe('reciprocalRankFusion：引用选择（prefer）', () => {
  it('缺省 first ⇒ 保留首次出现的引用', () => {
    const first = { id: 'x', from: 'kw' };
    const last = { id: 'x', from: 'sem' };
    const out = reciprocalRankFusion({
      lists: [[first], [last]],
      keyOf: (x) => x.id,
    });
    expect(out[0]!.item).toBe(first);
  });

  it('last ⇒ 保留末次出现的引用', () => {
    const first = { id: 'x', from: 'kw' };
    const last = { id: 'x', from: 'sem' };
    const out = reciprocalRankFusion({
      lists: [[first], [last]],
      keyOf: (x) => x.id,
      prefer: 'last',
    });
    expect(out[0]!.item).toBe(last);
  });
});

describe('reciprocalRankFusion：排序 / 截断 / 零拷贝', () => {
  it('score 降序，同分按 key 升序（确定性）', () => {
    const out = reciprocalRankFusion({
      lists: [[item('b'), item('a')], [item('c')]],
      keyOf: (x) => x.id,
    });
    // b、c 均为 rank0 ⇒ 同分 1/61（key 升序 ⇒ b 前于 c）；a 为 rank1 ⇒ 1/62
    expect(out.map((e) => e.key)).toEqual(['b', 'c', 'a']);
  });

  it('limit 在返回前截断，且只暴露前 N 条', () => {
    const out = reciprocalRankFusion({
      lists: [[item('a'), item('b'), item('c')]],
      keyOf: (x) => x.id,
      limit: 2,
    });
    expect(out.map((e) => e.key)).toEqual(['a', 'b']);
  });

  it('item 为原始引用（非克隆），实现零拷贝', () => {
    const a = item('a');
    const out = reciprocalRankFusion({ lists: [[a]], keyOf: (x) => x.id });
    expect(out[0]!.item).toBe(a);
  });
});

describe('rrfMaxScore：归一化上界（值域契约）', () => {
  it('缺省 k=60 ⇒ Σw/(k+1)（默认权重 [0.4,0.6] ⇒ 1/61）', () => {
    expect(rrfMaxScore([0.4, 0.6])).toBeCloseTo(1 / 61, 12);
  });

  it('自定义 k ⇒ 与 reciprocalRankFusion 同一位移', () => {
    expect(rrfMaxScore([1, 1], 9)).toBeCloseTo(2 / 10, 12);
  });

  it('权重 ≤0 不参与累加（与融合侧「权重 0 跳过该路」一致）', () => {
    expect(rrfMaxScore([1, 0, 1])).toBeCloseTo(2 / 61, 12);
    expect(rrfMaxScore([0, 0])).toBe(0);
  });

  it('上确界可达：两路均 rank0 ⇒ raw/max = 1', () => {
    const raw = reciprocalRankFusion({
      lists: [[item('a')], [item('a')]],
      keyOf: (x) => x.id,
      weights: [0.4, 0.6],
    })[0]!.score;
    expect(raw / rrfMaxScore([0.4, 0.6])).toBeCloseTo(1, 12);
  });

  it('单路命中 ⇒ raw/max 严格小于 1（不越界）', () => {
    const raw = reciprocalRankFusion({
      lists: [[item('a')], []],
      keyOf: (x) => x.id,
      weights: [0.4, 0.6],
    })[0]!.score;
    const normalized = raw / rrfMaxScore([0.4, 0.6]);
    expect(normalized).toBeCloseTo(0.4, 12);
    expect(normalized).toBeLessThan(1);
  });
});
