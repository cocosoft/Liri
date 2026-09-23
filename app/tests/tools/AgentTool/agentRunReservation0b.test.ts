/**
 * 0b RAII 额度预留（M-9，2026-09-22）
 *
 * 修复前：`AgentTool.checkConcurrencyLimit(plannedWeight): boolean` 是**纯判定**，与
 * `beginRun` 的 `_ledger.register()` 是两次独立调用 ⇒ "判定通过但未登记 / 登记后抛错"
 * 都会泄漏并发槽位（递减只能依赖后续 `settle()` 被调到）。
 *
 * 修复后：`AgentRunLedger.tryReserve()` **判定与占位同一次同步调用**，返回 guard，
 * 由 `AgentTool.execute()` 的 `finally` 释放（结构性保证，不依赖调用纪律）。
 *
 * **硬约束（Liri 意见 3）**：`release()` 必须**委托 `settle()`**（终态幂等），
 * ❌ 禁止独立计数器自减 —— 否则会在 `cancel_requested` 期间提前释放槽位
 * （`isLive` 刻意把 `cancel_requested` 算作 live ⇒ 这正是 M-1 要消灭的行为）。
 * 本文件的第 3 个用例即为该约束的**守卫断言**。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  getAgentRunLedger,
  resetAgentRunLedger,
} from '../../../src/tools/AgentTool/AgentRunLedger';

const SID = 'sess-0b';

describe('0b：RAII 预留（判定与占位同一次同步调用）', () => {
  beforeEach(() => {
    resetAgentRunLedger();
  });

  afterEach(() => {
    resetAgentRunLedger();
  });

  test('超限 ⇒ 返回 null 且**不登记**（判定失败不留痕）', () => {
    const ledger = getAgentRunLedger();
    ledger.register({ id: 'a-1', name: 'a-1', type: 'general', weight: 2 });
    expect(ledger.liveCount()).toBe(2);

    const denied = ledger.tryReserve({
      id: 'a-2',
      name: 'a-2',
      type: 'general',
      weight: 1,
      limit: 2,
    });
    expect(denied).toBeNull();
    expect(ledger.liveCount()).toBe(2); // 未占位
    expect(ledger.view('a-2')).toBeUndefined(); // 未登记
  });

  test('预留成功 ⇒ 同一次调用内已占额；`release()` 释放并落终态', () => {
    const ledger = getAgentRunLedger();
    const res = ledger.tryReserve({
      id: 'b-1',
      name: 'b-1',
      type: 'general',
      sessionId: SID,
      weight: 3,
      limit: 3,
    });
    expect(res).not.toBeNull();
    expect(ledger.liveCount()).toBe(3);
    expect(ledger.view('b-1')?.status).toBe('running');

    res?.release();
    expect(ledger.liveCount()).toBe(0);
    // 释放是"落终态"而非"抹掉条目"：归因仍可查
    expect(ledger.view('b-1')?.status).toBe('failed');
  });

  test('**禁止独立计数器**：`cancel_requested` 期间 release ⇒ 终态收敛（非"额度自减但条目仍 live"）', () => {
    const ledger = getAgentRunLedger();
    const res = ledger.tryReserve({
      id: 'c-1',
      name: 'c-1',
      type: 'general',
      sessionId: SID,
      weight: 1,
      limit: 1,
    });
    ledger.requestCancel('c-1');
    expect(ledger.view('c-1')?.status).toBe('cancel_requested');

    res?.release();
    // 额度与状态**同时**收敛（若 release 是独立计数器，此处条目会停在 cancel_requested
    // 且 hasLiveRunsForSession 恒真 ⇒ 父会话永不恢复）
    expect(ledger.liveCount()).toBe(0);
    expect(ledger.view('c-1')?.status).toBe('failed');
    expect(ledger.hasLiveRunsForSession(SID)).toBe(false);
  });

  test('release 幂等：条目已按真实结果结算 ⇒ no-op，不反向改写终态', () => {
    const ledger = getAgentRunLedger();
    const res = ledger.tryReserve({
      id: 'd-1',
      name: 'd-1',
      type: 'general',
      sessionId: SID,
      weight: 1,
      limit: 1,
    });
    // 正常路径：按真实结果结算 completed
    expect(ledger.settle('d-1', 'completed')).toBe(true);

    res?.release();
    res?.release(); // 多次调用安全
    expect(ledger.view('d-1')?.status).toBe('completed'); // 终态未被改写成 failed
    expect(ledger.liveCount()).toBe(0);
  });

  test('权重归一与 register 同源（非法值 → 1；判定与占位口径一致）', () => {
    const ledger = getAgentRunLedger();
    const res = ledger.tryReserve({
      id: 'e-1',
      name: 'e-1',
      type: 'general',
      weight: Number.NaN, // 非法 ⇒ 折回 1（与 register 同源）
      limit: 1,
    });
    expect(res).not.toBeNull();
    expect(ledger.liveCount()).toBe(1);
  });
});
