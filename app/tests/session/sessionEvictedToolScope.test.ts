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
 * 会话级工具作用域的**回收链路**（2026-10-23，会话级悬空资源取证）。
 *
 * 缺陷（代码取证，非推测）：`MCPTool` 把 **MCP 长连接**作为长生命周期副作用登记进
 * `toolScopeManager.getSessionScope(sessionId).onDispose(...)`，但唯一的回收入口
 * `ToolScopeManager.disposeSession()` **全仓零调用** ⇒
 *  ① `sessionScopes` 每会话一条、**无 TTL / 无上限**（daemon 长跑单调增长）；
 *  ② 会话删除后 MCP 连接也不会断开。
 *
 * 本文件锁定三件事（先红后绿）：
 *  ① `disposeSession` 自身语义：执行 onDispose、删条目、幂等；
 *  ② `ChatSessionTeardown.deleteSession` / `clearAllSessions` 会回收会话级 scope；
 *  ③ `SessionPruner.prune()`（只删存储、不经 teardown 的旁路）同样回收。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { ChatSessionTeardown } from '../../src/chat/manager/sessionTeardown.js';
import type { ChatSessionTeardownDeps } from '../../src/chat/manager/sessionTeardown.js';
import { SessionPruner } from '../../src/session/SessionPruner.js';
import type { SessionStorage } from '../../src/session/SessionStorage.js';
import {
  ToolScopeManager,
  toolScopeManager,
} from '../../src/tool/ToolScopeManager.js';
import { getLogger } from '../../src/monitoring/logs/Logger.js';

const restores: Array<() => void> = [];

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
});

/** 轮询等待 fire-and-forget 回收落地（动态 import + dispose 均为异步） */
async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** 以最小 fake deps 构造 teardown，并隔离与本次断言无关的两条级联（PDCA / 审批项） */
function makeTeardown(
  stored: Array<{ id: string; metadata?: Record<string, unknown> }> = []
): ChatSessionTeardown {
  const deps = {
    getSessionLifecycle: () => ({
      deleteSession: async () => {},
      clearAllSessions: async () => {},
    }),
    getSessionGateway: () => ({ listSessions: async () => stored }),
    getCheckpointService: () => ({
      listCheckpoints: async () => [],
      deleteSessionCheckpoints: async () => {},
    }),
    dropEventLogSession: () => {},
    clearToolRound: () => {},
  } as unknown as ChatSessionTeardownDeps;

  const teardown = new ChatSessionTeardown(deps);
  const internals = teardown as unknown as {
    closeSessionPdca: () => void;
    dismissSessionInboxItems: () => Promise<void>;
  };
  internals.closeSessionPdca = () => {};
  internals.dismissSessionInboxItems = async () => {};
  return teardown;
}

describe('ToolScopeManager.disposeSession：语义', () => {
  it('执行 onDispose、移除条目、幂等', async () => {
    const manager = new ToolScopeManager();
    let disposed = 0;
    manager.getSessionScope('scope-a').onDispose(() => {
      disposed += 1;
    });
    expect(manager.hasSessionScope('scope-a')).toBe(true);

    await manager.disposeSession('scope-a');
    expect(disposed).toBe(1);
    expect(manager.hasSessionScope('scope-a')).toBe(false);

    // 幂等：重复回收不动第二次 dispose
    await manager.disposeSession('scope-a');
    expect(disposed).toBe(1);
  });
});

describe('会话销毁链路：回收会话级工具作用域', () => {
  it('deleteSession(sid) ⇒ 该会话 scope 被 dispose（先红后绿）', async () => {
    const sid = 'evict-toolscope-delete';
    let disposed = 0;
    toolScopeManager.getSessionScope(sid).onDispose(() => {
      disposed += 1;
    });

    await makeTeardown().deleteSession(sid);
    await waitFor(() => !toolScopeManager.hasSessionScope(sid));

    expect(disposed).toBe(1);
  });

  it('clearAllSessions(moduleType) ⇒ 被清会话成批回收（过滤口径与清空一致）', async () => {
    const inScope = ['evict-clear-1', 'evict-clear-2'];
    const outScope = 'evict-clear-other';
    for (const sid of [...inScope, outScope]) {
      toolScopeManager.getSessionScope(sid).onDispose(() => {});
    }

    const teardown = makeTeardown([
      { id: 'evict-clear-1', metadata: { moduleType: 'chat' } },
      { id: 'evict-clear-2', metadata: { moduleType: 'chat' } },
      { id: 'evict-clear-other', metadata: { moduleType: 'project' } },
    ]);
    await teardown.clearAllSessions('chat');
    await waitFor(() => !toolScopeManager.hasSessionScope('evict-clear-2'));

    expect(toolScopeManager.hasSessionScope('evict-clear-1')).toBe(false);
    expect(toolScopeManager.hasSessionScope('evict-clear-2')).toBe(false);
    // 不在本次清空范围内的会话不受影响
    expect(toolScopeManager.hasSessionScope(outScope)).toBe(true);
    await toolScopeManager.disposeSession(outScope);
  });

  it('回收失败不阻塞删除主流程（仅告警）', async () => {
    const disposeSpy = spyOn(
      toolScopeManager,
      'disposeSession'
    ).mockRejectedValue(new Error('scope dispose boom'));
    const warnSpy = spyOn(getLogger('chat:manager'), 'warn').mockImplementation(
      () => {}
    );
    restores.push(() => disposeSpy.mockRestore());
    restores.push(() => warnSpy.mockRestore());

    await expect(
      makeTeardown().deleteSession('evict-toolscope-fail')
    ).resolves.toBeUndefined();

    await waitFor(() =>
      warnSpy.mock.calls.some((c) => String(c[0]).includes('工具作用域'))
    );
  });
});

describe('SessionPruner 旁路：只删存储也要回收会话级 scope', () => {
  it('prune() 删除的会话 ⇒ scope 被回收', async () => {
    const now = Date.now();
    const sid = 'evict-prune-1';
    toolScopeManager.getSessionScope(sid).onDispose(() => {});

    const storage: SessionStorage = {
      saveSession: async () => {},
      loadSession: async (id: string) =>
        ({ id, updatedAt: new Date(now - 40 * 24 * 60 * 60 * 1000) }) as never,
      saveMessage: async () => {},
      loadMessages: async () => [],
      saveMetadata: async () => {},
      loadMetadata: async () => null,
      deleteSession: async () => {},
      listSessions: async () => [sid],
      sessionExists: async () => true,
      compactSession: async () => {},
    };

    const result = await new SessionPruner(storage, { maxAgeDays: 30 }).prune();
    expect(result.deletedIds).toEqual([sid]);
    await waitFor(() => !toolScopeManager.hasSessionScope(sid));
  });
});
