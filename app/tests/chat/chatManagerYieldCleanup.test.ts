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
 * B1-6（P0-6）：`ChatManager.cleanup()` 必须清空**模块级单例**的等待集。
 *
 * 修复前：cleanup 卸载了 listener、置 null、复位 flag，但**没有** `getYieldRegistry().clear()`
 * ⇒ `YieldRegistry.entries` 是进程级单例，条目跨实例残留 ⇒ 新实例读到上一实例的陈旧登记
 * 并对它发起恢复（旧实例的闭包已失效）。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import { ChatManagerImpl } from '../../src/chat/ChatManager.js';
import { getYieldRegistry, resetYieldRegistry } from '../../src/session/yield';

describe('B1-6：实例 cleanup 清空模块级等待集', () => {
  afterEach(() => {
    resetYieldRegistry();
  });

  it('cleanup 后单例等待集为空（陈旧登记不跨实例残留）', () => {
    const registry = getYieldRegistry();
    registry.register({
      sessionId: 's-stale',
      turn: 3,
      toolCallId: 'c-stale',
      yieldedAt: 10,
    });
    expect(registry.isWaiting('s-stale')).toBe(true);

    new ChatManagerImpl().cleanup();

    // 修复前：cleanup 无 clear() ⇒ 此处仍为 true（陈旧登记残留 ⇒ 新实例误恢复）
    expect(getYieldRegistry().size()).toBe(0);
    expect(getYieldRegistry().isWaiting('s-stale')).toBe(false);
  });
});
