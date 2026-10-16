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
 * Task Ghost 回归（2026-10-12）：会话删除同步清理 **taor 链**检查点。
 *
 * 缺陷（实证）：`ChatSessionTeardown.deleteSession` 只清**流式链**
 * （`session_checkpoints`，经 `deleteSessionCheckpoints`），**不清** **taor 链**
 * （`taor_checkpoints`）。删除会话后 taor 行残留 ⇒ 服务重启时
 * `ChatBootstrap.resumeBudgetSuspends()` 会把已删会话重新登记为「幽灵挂起」⇒ 用户放行时
 * 对已删会话尝试续跑（额外 LLM 开销 + 误导日志）。
 *
 * 修复：`deleteSession` 的检查点清理路径**同时**经 `ResumeManager.clearSession(sessionId)`
 * 清 taor 链（与流式链**两链对称**），失败仅告警、不阻塞删除。
 *
 * 本文件锁定两件事（先红后绿）：
 *  ① `deleteSession(sid)` 会触发 taor 链清理（修复前 `clearSession` 零调用 ⇒ 红）；
 *  ② taor 清理抛错时 `deleteSession` **仍正常返回**（仅告警，不因清理失败中断删除）。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { ChatSessionTeardown } from '../../src/chat/manager/sessionTeardown.js';
import type { ChatSessionTeardownDeps } from '../../src/chat/manager/sessionTeardown.js';
import { ResumeManager } from '../../src/query/ResumeManager.js';
import {
  getBudgetSuspendCoordinator,
  resetBudgetSuspendForTest,
} from '../../src/query/budgetSuspend.js';
import { getLogger } from '../../src/monitoring/logs/Logger.js';

/** 轮询等待异步 fire-and-forget 清理落地（动态 import + 清理均为异步） */
async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/**
 * 以最小 fake deps 构造 `ChatSessionTeardown`（不触真实磁盘/DB），并隔离两条与本次断言
 * 无关的级联（PDCA 收口 / 审批项关闭——它们会动态 import 真实模块并触库），
 * 只保留检查点清理路径为真实实现。
 */
function makeTeardown(
  opts: {
    /** `clearAllSessions` 用例用：存储层会话清单（含 `metadata.moduleType` 供过滤） */
    stored?: Array<{ id: string; metadata?: Record<string, unknown> }>;
  } = {}
): ChatSessionTeardown {
  const deps = {
    // 会话生命周期删除（fake：立即成功，不落盘）
    getSessionLifecycle: () => ({
      deleteSession: async () => {},
      clearAllSessions: async () => {},
    }),
    // 会话网关（默认空清单；`clearAllSessions` 用例可按需注入）
    getSessionGateway: () => ({ listSessions: async () => opts.stored ?? [] }),
    // 检查点服务（fake：无检查点、删除为空操作 ⇒ 只为走通流式链路径）
    getCheckpointService: () => ({
      listCheckpoints: async () => [],
      deleteSessionCheckpoints: async () => {},
    }),
    dropEventLogSession: () => {},
    clearToolRound: () => {},
  } as unknown as ChatSessionTeardownDeps;

  const teardown = new ChatSessionTeardown(deps);
  // 隔离无关级联（避免动态 import 真实模块并触 DB）；用实例属性覆盖私有方法。
  const internals = teardown as unknown as {
    closeSessionPdca: () => void;
    dismissSessionInboxItems: () => Promise<void>;
  };
  internals.closeSessionPdca = () => {};
  internals.dismissSessionInboxItems = async () => {};
  return teardown;
}

/** 本文件创建的 spy 的还原器（逐用例还原；沿用本仓 `mockRestore()` 惯例） */
const restoreFns: Array<() => void> = [];

afterEach(() => {
  while (restoreFns.length > 0) restoreFns.pop()?.();
});

describe('Task Ghost：deleteSession 同步清理 taor 链检查点', () => {
  it('① deleteSession(sid) 触发 taor 链清理（ResumeManager.clearSession 被调用一次）', async () => {
    const clearSpy = spyOn(
      ResumeManager.prototype,
      'clearSession'
    ).mockResolvedValue(0);
    restoreFns.push(() => clearSpy.mockRestore());
    const teardown = makeTeardown();
    const sid = 'ghost-taor-1';

    await teardown.deleteSession(sid);
    await waitFor(() => clearSpy.mock.calls.length > 0);

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalledWith(sid);
  });

  it('② taor 清理抛错时 deleteSession 仍正常返回（仅告警，不阻塞删除）', async () => {
    const clearSpy = spyOn(
      ResumeManager.prototype,
      'clearSession'
    ).mockRejectedValue(new Error('taor cleanup boom'));
    const warnSpy = spyOn(getLogger('chat:manager'), 'warn').mockImplementation(
      () => {}
    );
    restoreFns.push(() => clearSpy.mockRestore());
    restoreFns.push(() => warnSpy.mockRestore());
    const teardown = makeTeardown();
    const sid = 'ghost-taor-2';

    await expect(teardown.deleteSession(sid)).resolves.toBeUndefined();

    // 清理失败确实被观察到（告警含 'taor'）⇒ 非静默吞错
    await waitFor(() =>
      warnSpy.mock.calls.some((c) => String(c[0]).includes('taor'))
    );
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('taor'))).toBe(
      true
    );
  });
});

/**
 * Task Ghost-2（2026-10-17，台账 `BUDGET-SUSPEND-DELETE-RELEASE`）：会话删除/清空一并释放
 * **预算挂起协调器**的**进程内登记**。
 *
 * 缺陷（真机实证）：上面两条清理只覆盖**检查点**（磁盘）；协调器另持
 * `sessionId → 挂起条目` 的**内存**登记（非持久化事实源），会话被删后**不会自行消失** ⇒
 *  ① `GET /v1/cost/daily-budget/suspend` 仍列出已删会话（**幽灵条目**，重启才消失）；
 *  ② 全局放行会尝试唤醒已不存在的会话 ⇒ 续跑失败回滚 + warn（无害但噪音）。
 *
 * 修复前 ① 必然红（删除后 `isSuspended` 仍为 `true`）。
 */
describe('Task Ghost-2：deleteSession / clearAllSessions 释放预算挂起登记', () => {
  it('① 删除**挂起中**的会话 ⇒ 协调器登记被释放（先红后绿）', async () => {
    resetBudgetSuspendForTest();
    const c = getBudgetSuspendCoordinator();
    c.suspend({
      sessionId: 'susp-1',
      chain: 'stream',
      reason: 'daily_budget_exhausted',
    });
    expect(c.isSuspended('susp-1')).toBe(true); // 修复前删除后此断言仍为 true ⇒ 红

    await makeTeardown().deleteSession('susp-1');
    await waitFor(() => !c.isSuspended('susp-1'));

    expect(c.isSuspended('susp-1')).toBe(false);
    expect(c.list().map((e) => e.sessionId)).toEqual([]);
    resetBudgetSuspendForTest();
  });

  it('② 只释放被删会话；未挂起者删除是幂等 no-op，不误伤其它挂起会话', async () => {
    resetBudgetSuspendForTest();
    const c = getBudgetSuspendCoordinator();
    c.suspend({ sessionId: 'keep-1', chain: 'stream', reason: 'r1' });
    c.suspend({ sessionId: 'susp-2', chain: 'taor', reason: 'r2' });

    const teardown = makeTeardown();
    await teardown.deleteSession('susp-2');
    await expect(teardown.deleteSession('never-suspended')).resolves.toBe(
      undefined
    );
    await waitFor(() => !c.isSuspended('susp-2'));

    expect(c.isSuspended('susp-2')).toBe(false);
    expect(c.isSuspended('keep-1')).toBe(true);
    expect(c.list().map((e) => e.sessionId)).toEqual(['keep-1']);
    resetBudgetSuspendForTest();
  });

  it('③ 清空会话 ⇒ 被清会话的登记**成批**释放，且过滤口径与清空一致', async () => {
    resetBudgetSuspendForTest();
    const c = getBudgetSuspendCoordinator();
    c.suspend({ sessionId: 'b1', chain: 'stream', reason: 'r' });
    c.suspend({ sessionId: 'b2', chain: 'stream', reason: 'r' });
    c.suspend({ sessionId: 'other-module', chain: 'stream', reason: 'r' });

    const teardown = makeTeardown({
      stored: [
        { id: 'b1', metadata: { moduleType: 'chat' } },
        { id: 'b2', metadata: { moduleType: 'chat' } },
        { id: 'other-module', metadata: { moduleType: 'project' } },
      ],
    });
    await teardown.clearAllSessions('chat');
    await waitFor(() => !c.isSuspended('b1'));

    expect(c.isSuspended('b1')).toBe(false);
    expect(c.isSuspended('b2')).toBe(false);
    // 不在本次清空范围内的会话**不受影响**（释放口径与清空过滤同源）
    expect(c.isSuspended('other-module')).toBe(true);
    resetBudgetSuspendForTest();
  });
});
