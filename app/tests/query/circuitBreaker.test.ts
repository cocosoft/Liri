// MIT License
// Copyright (c) 2026 Liri
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
 * CircuitBreaker 硬失败统计语义测试（A7，2026-09-04）
 *
 * 守护的修复：TAORLoop._observeRound 原 success = !stopped || completed，
 * observe 时 stopped 几乎恒 false → success 恒 true，breaker 统计不到失败。
 * 现仅把"工具错误轮"计为失败（success:false, error:'tool_error'）——
 * 无进展/疲劳轮仍是 success:true，不应计入熔断。
 */
import { describe, it, expect } from 'bun:test';
import { CircuitBreaker } from '../../src/query/CircuitBreaker';

function makeBreaker() {
  return new CircuitBreaker({
    maxConsecutiveSameError: 3,
    maxConsecutiveFailures: 5,
    resetTimeoutMs: 999_999, // 测试不等待恢复窗口
  });
}

describe('CircuitBreaker 硬失败统计（A7）', () => {
  it('连续工具错误轮（success:false + tool_error）达到阈值触发熔断', () => {
    const cb = makeBreaker();
    for (let i = 0; i < 3; i++) {
      cb.recordTurn({
        success: false,
        error: 'tool_error',
        turnCount: i + 1,
        tokenUsage: 0,
        maxTokens: 0,
      });
      if (i < 2) expect(cb.shouldBreak().break).toBe(false);
    }
    expect(cb.shouldBreak().break).toBe(true);
  });

  it('无进展/普通成功轮（success:true）不计入失败，不误熔断', () => {
    const cb = makeBreaker();
    for (let i = 0; i < 50; i++) {
      cb.recordTurn({
        success: true,
        turnCount: i + 1,
        tokenUsage: 0,
        maxTokens: 0,
      });
      expect(cb.shouldBreak().break).toBe(false);
    }
    expect(cb.getState().totalFailures).toBe(0);
  });

  it('失败间夹成功轮不清空累计但未达阈值不熔断（连续同类错误口径）', () => {
    const cb = makeBreaker();
    cb.recordTurn({ success: false, error: 'tool_error', turnCount: 1, tokenUsage: 0, maxTokens: 0 });
    cb.recordTurn({ success: true, turnCount: 2, tokenUsage: 0, maxTokens: 0 });
    cb.recordTurn({ success: false, error: 'tool_error', turnCount: 3, tokenUsage: 0, maxTokens: 0 });
    expect(cb.shouldBreak().break).toBe(false);
  });

  it('reset 后恢复 closed，可再次统计', () => {
    const cb = makeBreaker();
    for (let i = 0; i < 3; i++) {
      cb.recordTurn({ success: false, error: 'tool_error', turnCount: i + 1, tokenUsage: 0, maxTokens: 0 });
    }
    expect(cb.shouldBreak().break).toBe(true);
    cb.reset();
    expect(cb.shouldBreak().break).toBe(false);
    expect(cb.getState().totalFailures).toBe(0);
  });
});
