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
 * PR3 — Session safety 测试（2026-10-09）
 *
 * 验收 ⑦：`lastActivityAt` 陈旧但 `activeExecutionId=E1` ⇒ `cleanIdle()` 不回收
 * （既不置 idle 也不删除）。并覆盖 begin/end 登记的 fencing 一致性。
 */
import { describe, it, expect } from 'bun:test';
import { ChannelSessionManager } from '../../src/channels/session/ChannelSessionManager.js';

describe('PR3 Session safety：cleanIdle 跳过执行中的会话', () => {
  it('⑦ 陈旧 lastActivityAt 但有 activeExecutionId ⇒ 不回收、不置 idle', () => {
    const mgr = new ChannelSessionManager(1000); // 1s idle 阈值
    const s = mgr.create('telegram', 'conv1', 'user1');
    s.lastActivityAt = Date.now() - 10_000; // 表面"空闲"
    mgr.beginExecution(s.id, 'exec-1');

    expect(mgr.cleanIdle()).toBe(0);
    expect(mgr.get(s.id)).toBeDefined();
    expect(mgr.get(s.id)!.status).toBe('active');
  });

  it('endExecution 之后 ⇒ 恢复可回收', () => {
    const mgr = new ChannelSessionManager(1000);
    const s = mgr.create('telegram', 'conv2', 'user2');
    mgr.beginExecution(s.id, 'exec-2');
    mgr.endExecution(s.id, 'exec-2');
    s.lastActivityAt = Date.now() - 10_000;

    expect(mgr.cleanIdle()).toBeGreaterThan(0);
  });

  it('endExecution 仅清除匹配的 executionId（防旧执行清掉新执行）', () => {
    const mgr = new ChannelSessionManager(1000);
    const s = mgr.create('telegram', 'conv3', 'user3');
    mgr.beginExecution(s.id, 'exec-new');

    expect(mgr.endExecution(s.id, 'exec-old')).toBe(false);
    expect(mgr.get(s.id)!.activeExecutionId).toBe('exec-new');
    expect(mgr.endExecution(s.id, 'exec-new')).toBe(true);
    expect(mgr.get(s.id)!.activeExecutionId).toBeUndefined();
  });
});
