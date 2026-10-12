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
function makeTeardown(): ChatSessionTeardown {
  const deps = {
    // 会话生命周期删除（fake：立即成功，不落盘）
    getSessionLifecycle: () => ({ deleteSession: async () => {} }),
    // 会话网关（本测试不经 clearAllSessions，占位即可）
    getSessionGateway: () => ({ listSessions: async () => [] }),
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
