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
 * C2 — EventBus 三语义显式化测试（2026-10-09）
 *
 * 覆盖 `.trae/specs/eventbus-semantics.md` §5：
 * A1 publishAndWait（按序 await / 计数 / 失败不中断）；A2 publish fire-and-forget；A3 once 幂等。
 */
import { describe, it, expect } from 'bun:test';
import { EventBusImpl } from '../../src/core/events/EventBus.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('C2 EventBus 三语义', () => {
  it('A1 publishAndWait：按序 await，后一者在前一者 resolve 后才开始', async () => {
    const bus = new EventBusImpl();
    const order: string[] = [];
    bus.subscribe('e', async () => {
      order.push('a:start');
      await sleep(10);
      order.push('a:end');
    });
    bus.subscribe('e', () => {
      order.push('b');
    });

    const res = await bus.publishAndWait('e');
    expect(order).toEqual(['a:start', 'a:end', 'b']);
    expect(res).toEqual({ delivered: 2, failed: 0 });
  });

  it('A1 publishAndWait：失败不中断其余，且不整体抛错', async () => {
    const bus = new EventBusImpl();
    let secondRan = false;
    bus.subscribe('e', () => {
      throw new Error('boom');
    });
    bus.subscribe('e', () => {
      secondRan = true;
    });

    const res = await bus.publishAndWait('e');
    expect(res).toEqual({ delivered: 1, failed: 1 });
    expect(secondRan).toBe(true);
  });

  it('顺序契约：先精确匹配、后 "*" 通配', async () => {
    const bus = new EventBusImpl();
    const order: string[] = [];
    bus.subscribe('*', () => {
      order.push('wildcard');
    });
    bus.subscribe('evt', () => {
      order.push('exact');
    });

    await bus.publishAndWait('evt');
    expect(order).toEqual(['exact', 'wildcard']);
  });

  it('A2 publish 为 fire-and-forget（不 await）', async () => {
    const bus = new EventBusImpl();
    const order: string[] = [];
    bus.subscribe('e2', async () => {
      await sleep(10);
      order.push('done');
    });

    bus.publish('e2');
    expect(order).toEqual([]); // 尚未完成（未 await）
    await sleep(25);
    expect(order).toEqual(['done']);
  });

  it('A3 once：重入 publish 仍至多触发一次，且触发后自动退订', () => {
    const bus = new EventBusImpl();
    let count = 0;
    bus.once('e4', () => {
      count++;
      // 监听器内再 publish 同事件（重入）
      bus.publish('e4');
    });

    bus.publish('e4');
    expect(count).toBe(1);
    expect(bus.listenerCount('e4')).toBe(0);
  });
});
