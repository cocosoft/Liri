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
 * O46 语义回归（2026-09-13）：**用户显式分工**优先于 SmartRouter，
 * 但**系统自动填充**的分工不得压过智能路由。
 *
 * 守护的具体缺陷：v1 修复只看"分工表里有条目"→ 而 `runAutoDiscover()` 会自动填充
 * 9 个 chat 类任务（default/chat/coding/agent/…）→ 会把自动填充误判为用户意图、
 * 令智能路由被静默大面积绕过。故引入来源标记，本文件锁死三条规则。
 */

import { describe, test, expect } from 'bun:test';
import { pickExplicitTaskModel } from '../../src/ai/router/resolveModelRoute';

describe('O46 分工优先级（显式 vs 自动填充）', () => {
  test('① 用户显式设置过 → 采用分工表里的模型', () => {
    const picked = pickExplicitTaskModel('agent', ['agent'], {
      agent: 'deepseek-v4-flash',
    });
    expect(picked).toBe('deepseek-v4-flash');
  });

  test('② 仅系统自动填充（无来源标记）→ 不采用，交回 SmartRouter', () => {
    // 自动发现会写入 default/chat/coding/agent…，但**不**写来源标记
    const autoFilled = {
      default: 'some-chat-model',
      chat: 'some-chat-model',
      coding: 'some-chat-model',
    };
    expect(pickExplicitTaskModel('chat', [], autoFilled)).toBeUndefined();
    expect(pickExplicitTaskModel('coding', [], autoFilled)).toBeUndefined();
  });

  test('③ 有标记但该任务无模型（空/缺省）→ 不采用', () => {
    expect(pickExplicitTaskModel('agent', ['agent'], {})).toBeUndefined();
    expect(
      pickExplicitTaskModel('agent', ['agent'], { agent: '' })
    ).toBeUndefined();
  });

  test('④ 标记只对同名任务生效（不串键）', () => {
    const tasks = { agent: 'm-agent', chat: 'm-chat' };
    expect(pickExplicitTaskModel('chat', ['agent'], tasks)).toBeUndefined();
    expect(pickExplicitTaskModel('agent', ['agent'], tasks)).toBe('m-agent');
  });
});
