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

import { describe, expect, it } from 'bun:test';
import { scheduleTopoBatches } from './topoBatches.js';

describe('scheduleTopoBatches（Teamwork P0-1 共享拓扑分批）', () => {
  it('无依赖任务：单批全并行', () => {
    const batches = scheduleTopoBatches([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);
    expect(batches.length).toBe(1);
    expect(batches[0].map((t) => t.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('链式依赖：a→b→c 分三批', () => {
    const batches = scheduleTopoBatches([
      { id: 'a' },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] },
    ]);
    expect(batches.map((b) => b.map((t) => t.id))).toEqual([
      ['a'],
      ['b'],
      ['c'],
    ]);
  });

  it('菱形依赖：d 依赖 a、b，批序 a/b → d', () => {
    const batches = scheduleTopoBatches([
      { id: 'a' },
      { id: 'b' },
      { id: 'd', dependsOn: ['a', 'b'] },
    ]);
    expect(batches.length).toBe(2);
    expect(batches[0].map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(batches[1].map((t) => t.id)).toEqual(['d']);
  });

  it('后置依赖（forward dep）：c 依赖 a，但 a 在后——先跑 a 再跑 c', () => {
    const batches = scheduleTopoBatches([
      { id: 'c', dependsOn: ['a'] },
      { id: 'a' },
    ]);
    expect(batches.map((b) => b.map((t) => t.id))).toEqual([['a'], ['c']]);
  });

  it('死锁自愈：a↔b 环 → 尾批原顺序兜底执行', () => {
    const batches = scheduleTopoBatches([
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c' },
    ]);
    const all = batches.flat().map((t) => t.id);
    // c 无依赖先出；环 a/b 并入尾批不阻塞
    expect(batches[0].map((t) => t.id)).toEqual(['c']);
    expect(all).toHaveLength(3);
  });

  it('缺失依赖自愈：引用不存在的 id 视为满足', () => {
    const batches = scheduleTopoBatches([
      { id: 'a', dependsOn: ['ghost'] },
      { id: 'b' },
    ]);
    expect(batches.length).toBe(1);
    expect(batches[0].map((t) => t.id).sort()).toEqual(['a', 'b']);
  });
});
