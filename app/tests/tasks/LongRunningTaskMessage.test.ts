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
 * 长程任务 → 对话消息回写回归测试（§5 P1/P2）
 *
 * P1 消息回写：onTaskMessage 回调注入后，_emitTaskMessage 正确转发到会话；
 *              无回调/回写失败时静默不阻断任务。
 * P2 实时推送：_emitTaskEvent 广播 task:progress/completed 不抛错（广播失败兜底）。
 */
import { describe, it, expect } from 'bun:test';

import { LongRunningTaskOrchestrator } from '../../src/tasks/LongRunningTaskOrchestrator.js';

/** 通过对象访问私有成员（测试专用） */
function makeOrchestrator() {
  const executor = async () => 'mock-result';
  const o = new LongRunningTaskOrchestrator('t-test-1', executor) as unknown as {
    _sessionId: string | null;
    _onTaskMessage?: (sessionId: string, msgs: unknown[]) => void;
    _emitTaskMessage: (msgs: unknown[]) => void;
    _emitTaskEvent: (
      event: 'task:progress' | 'task:completed' | 'task:error',
      payload: Record<string, unknown>
    ) => Promise<void>;
  };
  return o;
}

describe('LongRunningTaskOrchestrator §5 P1 消息回写', () => {
  it('注入 onTaskMessage 后 _emitTaskMessage 正确转发到回调', () => {
    const o = makeOrchestrator();
    o._sessionId = 'session-1';
    const received: Array<{ sid: string; msgs: unknown[] }> = [];
    o._onTaskMessage = (sid, msgs) => received.push({ sid, msgs });

    o._emitTaskMessage([{ role: 'assistant', content: '任务步骤完成' }]);

    expect(received).toHaveLength(1);
    expect(received[0].sid).toBe('session-1');
    expect(received[0].msgs[0]).toEqual({
      role: 'assistant',
      content: '任务步骤完成',
    });
  });

  it('未注入回调时静默（不阻断任务执行）', () => {
    const o = makeOrchestrator();
    o._sessionId = 'session-1';
    // 无 _onTaskMessage
    expect(() =>
      o._emitTaskMessage([{ role: 'assistant', content: 'x' }])
    ).not.toThrow();
  });

  it('回写回调抛错时被捕获（不影响任务）', () => {
    const o = makeOrchestrator();
    o._sessionId = 'session-1';
    o._onTaskMessage = () => {
      throw new Error('mock write failure');
    };
    expect(() =>
      o._emitTaskMessage([{ role: 'assistant', content: 'x' }])
    ).not.toThrow();
  });
});

describe('LongRunningTaskOrchestrator §5 P2 事件广播', () => {
  it('_emitTaskEvent 广播 task:progress / task:completed 不抛错（失败兜底）', async () => {
    const o = makeOrchestrator();
    await expect(
      o._emitTaskEvent('task:progress', {
        sessionId: 'session-1',
        status: 'running',
        stepDesc: '步骤',
      })
    ).resolves.toBeUndefined();
    await expect(
      o._emitTaskEvent('task:completed', {
        sessionId: 'session-1',
        status: 'completed',
      })
    ).resolves.toBeUndefined();
  });
});
