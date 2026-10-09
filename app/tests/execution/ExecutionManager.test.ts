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
 * PR1 — Execution Identity 竞态/所有权测试（2026-10-09）
 *
 * 覆盖 spec §3-PR1 验收：
 * ① 正常 M1→E1 COMPLETED；
 * ② 同 Session 第二个执行 ⇒ QUEUED（绝不双 RUNNING）；
 * ③ late completion（E1 释放后 E2 取得所有权）⇒ E1 = STALE 且 assertCurrent() 抛错；
 * ④ acquire 原子（同一 tick 内只有一个 RUNNING）。
 * 另覆盖状态机 canTransition 与取消/心跳/释放语义。
 */
import { describe, it, expect } from 'bun:test';
import {
  ExecutionManager,
  ExecutionAbortedError,
  StaleExecutionError,
  canTransition,
  isActiveStatus,
  isExecutionAbortedError,
  isTerminalStatus,
} from '../../src/execution/index.js';

describe('PR1 Execution 状态机', () => {
  it('合法/非法转移', () => {
    expect(canTransition('RUNNING', 'COMPLETED')).toBe(true);
    expect(canTransition('CANCEL_REQUESTED', 'CANCELLED')).toBe(true);
    expect(canTransition('CANCEL_REQUESTED', 'COMPLETED')).toBe(false); // 未确认不得完成
    expect(canTransition('COMPLETED', 'RUNNING')).toBe(false); // 终态冻结
    expect(canTransition('RUNNING', 'RUNNING')).toBe(false);
  });

  it('终态/占用中判定', () => {
    expect(isTerminalStatus('STALE')).toBe(true);
    expect(isTerminalStatus('RUNNING')).toBe(false);
    expect(isActiveStatus('WAITING_USER')).toBe(true);
    expect(isActiveStatus('QUEUED')).toBe(false);
  });
});

describe('PR1 ExecutionManager 所有权与 fencing', () => {
  it('① 正常：acquire → complete → COMPLETED（释放后 session 空闲）', () => {
    const m = new ExecutionManager();
    const lease = m.acquire('s1', 'm1');
    expect(m.get(lease.executionId)?.status).toBe('RUNNING');
    expect(lease.isCurrent()).toBe(true);

    m.complete(lease.executionId);
    expect(m.get(lease.executionId)?.status).toBe('COMPLETED');
    expect(m.getBySession('s1')).toBeUndefined(); // 所有权已释放

    lease.release();
    expect(m.get(lease.executionId)).toBeUndefined(); // 终态记录被清理
  });

  it('② 同 Session 第二个执行 ⇒ QUEUED（绝不双 RUNNING）', () => {
    const m = new ExecutionManager();
    const e1 = m.acquire('s1', 'm1');
    const e2 = m.acquire('s1', 'm2');

    expect(m.get(e1.executionId)?.status).toBe('RUNNING');
    expect(m.get(e2.executionId)?.status).toBe('QUEUED');
    // owner 仍是 E1
    expect(m.getBySession('s1')?.executionId).toBe(e1.executionId);
    // 代次递增
    expect(e2.generation).toBe(e1.generation + 1);
    // E2 不能"完成"（非 owner）
    expect(() => m.complete(e2.executionId)).toThrow(StaleExecutionError);
  });

  it('③ late completion：E1 释放 → E2 取得所有权 → E1 完成被拒且置 STALE', () => {
    const m = new ExecutionManager();
    const e1 = m.acquire('s1', 'm1');
    e1.release(); // 所有权结束但未完成（模拟超时后释放）

    const e2 = m.acquire('s1', 'm2');
    expect(m.get(e2.executionId)?.status).toBe('RUNNING');

    // E1 的晚到完成：被 fencing 拒绝
    expect(() => m.assertCurrent(e1.executionId, e1.generation)).toThrow(
      StaleExecutionError
    );
    expect(() => m.complete(e1.executionId)).toThrow(StaleExecutionError);
    // E1 被标记 STALE，且未改写 session 的新执行
    expect(m.get(e1.executionId)?.status).toBe('STALE');
    expect(m.getBySession('s1')?.executionId).toBe(e2.executionId);
  });

  it('③-b 代次不匹配直接拒绝', () => {
    const m = new ExecutionManager();
    const e1 = m.acquire('s1');
    expect(() =>
      m.assertCurrent(
        e1.executionId,
        (e1.generation + 1) as typeof e1.generation
      )
    ).toThrow(StaleExecutionError);
  });

  it('④ acquire 原子：同一 tick 多次调用仅一个 RUNNING', () => {
    const m = new ExecutionManager();
    const leases = [m.acquire('s1'), m.acquire('s1'), m.acquire('s1')];
    const running = leases.filter(
      (l) => m.get(l.executionId)?.status === 'RUNNING'
    );
    const queued = leases.filter(
      (l) => m.get(l.executionId)?.status === 'QUEUED'
    );
    expect(running.length).toBe(1);
    expect(queued.length).toBe(2);
  });

  it('取消两段式：requestCancel → CANCEL_REQUESTED → confirmCancel → CANCELLED（释放所有权）', () => {
    const m = new ExecutionManager();
    const e1 = m.acquire('s1');
    expect(m.requestCancel(e1.executionId, 'INACTIVITY_TIMEOUT')).toBe(true);
    expect(m.get(e1.executionId)?.status).toBe('CANCEL_REQUESTED');

    // 未确认前：仍占用 ⇒ 后续执行 QUEUED（验收 ⑤：E2 不能起 = 非 RUNNING）
    const e2 = m.acquire('s1');
    expect(m.get(e2.executionId)?.status).toBe('QUEUED');
    // 未确认前不得完成（CANCEL_REQUESTED → COMPLETED 非法，fencing）
    expect(() => m.complete(e1.executionId)).toThrow(StaleExecutionError);

    // 第二段确认（grace 内底层已停）⇒ CANCELLED，释放所有权
    expect(m.confirmCancel(e1.executionId)).toBe(true);
    expect(m.get(e1.executionId)?.status).toBe('CANCELLED');
    expect(m.getBySession('s1')).toBeUndefined();

    // 释放后新执行可正常取得所有权
    const e3 = m.acquire('s1');
    expect(m.get(e3.executionId)?.status).toBe('RUNNING');

    e1.release();
    e2.release();
  });

  it('confirmCancel 仅对 CANCEL_REQUESTED 生效（RUNNING 时返回 false，不改状态）', () => {
    const m = new ExecutionManager();
    const e1 = m.acquire('s1');
    expect(m.confirmCancel(e1.executionId)).toBe(false);
    expect(m.get(e1.executionId)?.status).toBe('RUNNING');
  });

  it('未确认取消 ⇒ 保留 lease：e1 未 release 则 owner 仍为其（后续 acquire 一直 QUEUED）', () => {
    const m = new ExecutionManager();
    const e1 = m.acquire('s1');
    m.requestCancel(e1.executionId, 'INACTIVITY_TIMEOUT');
    // 模拟"grace 内未确认"：不调用 confirmCancel、不 release
    const e2 = m.acquire('s1');
    expect(m.get(e2.executionId)?.status).toBe('QUEUED');
    expect(m.getBySession('s1')?.executionId).toBe(e1.executionId);
    expect(m.get(e1.executionId)?.status).toBe('CANCEL_REQUESTED');
  });

  it('心跳：非终态更新 heartbeatAt；终态忽略', () => {
    const m = new ExecutionManager();
    const e1 = m.acquire('s1');
    const before = m.get(e1.executionId)!.heartbeatAt;
    m.heartbeat(e1.executionId);
    expect(m.get(e1.executionId)!.heartbeatAt).toBeGreaterThanOrEqual(before);
    m.complete(e1.executionId);
    const after = m.get(e1.executionId)!.heartbeatAt;
    m.heartbeat(e1.executionId);
    expect(m.get(e1.executionId)!.heartbeatAt).toBe(after);
  });

  it('不同 Session 互不干扰（可并行 RUNNING）', () => {
    const m = new ExecutionManager();
    const a = m.acquire('s1');
    const b = m.acquire('s2');
    expect(m.get(a.executionId)?.status).toBe('RUNNING');
    expect(m.get(b.executionId)?.status).toBe('RUNNING');
  });
});

describe('PR2 类型化中止原因（替代文案匹配）', () => {
  it('ExecutionAbortedError 携带 reason，类型守卫可判定', () => {
    const e = new ExecutionAbortedError('INACTIVITY_TIMEOUT', 'boom');
    expect(isExecutionAbortedError(e)).toBe(true);
    expect(e.reason).toBe('INACTIVITY_TIMEOUT');
    expect(e.code).toBe('EXEC_ABORTED');
  });

  it('非中止错误不被误判（不再解析 message 文案）', () => {
    expect(isExecutionAbortedError(new Error('超时 (>120s)'))).toBe(false);
    expect(isExecutionAbortedError('x')).toBe(false);
  });
});
