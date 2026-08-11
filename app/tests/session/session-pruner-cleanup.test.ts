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
 * SessionPruner 联动清理检查点测试
 *
 * 背景：会话剪枝器按 age/count 策略自动删除会话，若不同步清理检查点，
 * 会产生孤儿检查点（12GB 堆积根因之一）。
 * 修复：SessionPruner 构造注入 cleanupSessionCheckpoints 回调，删除会话后联动清理。
 */
import { describe, it, expect, beforeEach } from 'bun:test';

import { SessionPruner } from '../../src/session/SessionPruner';
import type { SessionStorage } from '../../src/session/SessionStorage';

function makeStorage(now: number): {
  storage: SessionStorage;
  deleted: string[];
} {
  const deleted: string[] = [];
  const storage: SessionStorage = {
    saveSession: async () => {},
    loadSession: async (id: string) =>
      ({
        id,
        updatedAt: new Date(now - 40 * 24 * 60 * 60 * 1000),
      }) as never,
    saveMessage: async () => {},
    loadMessages: async () => [],
    saveMetadata: async () => {},
    loadMetadata: async () => null,
    deleteSession: async (id: string) => {
      deleted.push(id);
    },
    listSessions: async () => ['s_old_1', 's_old_2'],
    sessionExists: async () => true,
    compactSession: async () => {},
  };
  return { storage, deleted };
}

describe('SessionPruner 联动清理检查点', () => {
  let cleanupCalls: string[];

  beforeEach(() => {
    cleanupCalls = [];
  });

  it('剪枝删除会话后调用检查点清理回调（每个被删会话）', async () => {
    const now = Date.now();
    const { storage, deleted } = makeStorage(now);
    const pruner = new SessionPruner(
      storage,
      { maxAgeDays: 30 },
      async (sessionId: string) => {
        cleanupCalls.push(sessionId);
      }
    );

    const result = await pruner.prune();

    expect(deleted).toEqual(['s_old_1', 's_old_2']);
    expect(result.deletedCount).toBe(2);
    expect(cleanupCalls).toEqual(['s_old_1', 's_old_2']);
  });

  it('无会话被剪枝时不触发检查点清理', async () => {
    const storage: SessionStorage = {
      saveSession: async () => {},
      loadSession: async (id: string) =>
        ({ id, updatedAt: new Date() }) as never,
      saveMessage: async () => {},
      loadMessages: async () => [],
      saveMetadata: async () => {},
      loadMetadata: async () => null,
      deleteSession: async () => {},
      listSessions: async () => ['s_fresh'],
      sessionExists: async () => true,
      compactSession: async () => {},
    };
    const pruner = new SessionPruner(
      storage,
      { maxAgeDays: 30 },
      async (sessionId: string) => {
        cleanupCalls.push(sessionId);
      }
    );

    const result = await pruner.prune();

    expect(result.deletedCount).toBe(0);
    expect(cleanupCalls).toEqual([]);
  });
});
