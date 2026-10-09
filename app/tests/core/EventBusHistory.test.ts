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
 * C2 / O4 — EventBus 历史快照（2026-10-09）
 *
 * `recordHistory` 存引用 → 存快照；`getHistory` 返回快照 ⇒
 * 发布方或消费方改写不再污染历史存储。
 */
import { describe, it, expect } from 'bun:test';
import { EventBusImpl } from '../../src/core/events/EventBus.js';

describe('C2/O4 EventBus 历史快照', () => {
  it('发布方随后改 payload 不污染历史', () => {
    const bus = new EventBusImpl(undefined, { historyEnabled: true });
    const payload = { n: 1 };
    bus.publish('demo', payload);
    payload.n = 999;
    expect((bus.getHistory()[0].data as { n: number }).n).toBe(1);
  });

  it('消费方改 getHistory 返回值不污染历史', () => {
    const bus = new EventBusImpl(undefined, { historyEnabled: true });
    bus.publish('demo', { n: 1 });
    const first = bus.getHistory();
    (first[0].data as { n: number }).n = 999;
    expect((bus.getHistory()[0].data as { n: number }).n).toBe(1);
  });
});
