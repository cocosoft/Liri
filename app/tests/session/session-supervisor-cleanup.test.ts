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
 * SessionSupervisor 联动清理检查点测试
 *
 * 背景：会话监管器定期回收 idle/ended 超阈值会话，若不同步清理检查点，
 * 会产生孤儿检查点。
 * 修复：SessionSupervisor 构造注入 cleanupSessionCheckpoints 回调，回收会话后联动清理。
 */
import { describe, it, expect, beforeEach } from 'bun:test';

import {
  SessionSupervisor,
  type SessionStore,
} from '../../src/core/session/SessionSupervisor';

describe('SessionSupervisor 联动清理检查点', () => {
  let cleanupCalls: string[];

  beforeEach(() => {
    cleanupCalls = [];
  });

  it('回收 idle 超阈值会话后调用检查点清理回调', async () => {
    const deleted: string[] = [];
    const store: SessionStore = {
      listSessions: async () => [
        {
          id: 's_idle',
          lastActivityAt: Date.now() - 3 * 60 * 60 * 1000,
          status: 'idle',
          createdAt: Date.now() - 24 * 60 * 60 * 1000,
        },
      ],
      markIdle: async () => {},
      deleteSession: async (sessionId: string) => {
        deleted.push(sessionId);
      },
    };

    const supervisor = new SessionSupervisor(
      store,
      { forceRecycleThreshold: 2 * 60 * 60 * 1000 },
      async (sessionId: string) => {
        cleanupCalls.push(sessionId);
      }
    );

    await supervisor.check();

    expect(deleted).toEqual(['s_idle']);
    expect(cleanupCalls).toEqual(['s_idle']);
  });

  it('活跃会话不被回收、不触发检查点清理', async () => {
    const deleted: string[] = [];
    const store: SessionStore = {
      listSessions: async () => [
        {
          id: 's_active',
          lastActivityAt: Date.now(),
          status: 'running',
          createdAt: Date.now() - 60 * 1000,
        },
      ],
      markIdle: async () => {},
      deleteSession: async (sessionId: string) => {
        deleted.push(sessionId);
      },
    };

    const supervisor = new SessionSupervisor(
      store,
      { forceRecycleThreshold: 2 * 60 * 60 * 1000 },
      async (sessionId: string) => {
        cleanupCalls.push(sessionId);
      }
    );

    await supervisor.check();

    expect(deleted).toEqual([]);
    expect(cleanupCalls).toEqual([]);
  });
});
