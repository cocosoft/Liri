/**
 * AgentRunLedger 测试（多 agent 协作方案 O2/O3/O10a）
 *
 * 锁定的语义：
 * 1. **局部化注销**（O2）—— 结算只注销自己那条，不影响其他在途条目；
 * 2. **终态幂等**（O2）—— 首次落定的终态不被后续上报反向改写；
 * 3. **两段式台账**（O2-4）—— 终态移入归因表，结算后仍可查；CAP 生效；
 * 4. **只读投影**（O3/O10a②）—— 查询返回新建对象且不外泄 `sessionId`；
 * 5. **取消中间态**（O10a③）—— `cancel_requested` 非终态、仍占并发槽位。
 */
import { describe, test, expect } from 'bun:test';
import {
  AgentRunLedger,
  canTransition,
  isTerminalStatus,
} from '../../../src/tools/AgentTool/AgentRunLedger';

function makeLedger(cap?: number): AgentRunLedger {
  return cap === undefined ? new AgentRunLedger() : new AgentRunLedger(cap);
}

describe('AgentRunLedger：结算与交错安全（O2）', () => {
  test('两代理并发：其一先结算只注销自己那条，另一仍在上报（不抛错、终态正确）', () => {
    const ledger = makeLedger();
    ledger.register({ id: 'a', name: 'A', type: 'general' });
    ledger.register({ id: 'b', name: 'B', type: 'general' });
    expect(ledger.liveCount()).toBe(2);

    // A 先收口（旧实现在此处会触发全表扫描清理，删掉 B 的条目 ⇒ B 后续 get()! 抛 TypeError）
    expect(ledger.settle('a', 'completed')).toBe(true);
    expect(ledger.liveCount()).toBe(1);
    expect(ledger.viewActive('b')?.status).toBe('running');

    // B 仍可正常上报终态
    expect(ledger.settle('b', 'failed')).toBe(true);
    expect(ledger.liveCount()).toBe(0);
    expect(ledger.view('a')?.status).toBe('completed');
    expect(ledger.view('b')?.status).toBe('failed');
  });

  test('终态幂等：已完成不被后续失败上报反向改写', () => {
    const ledger = makeLedger();
    ledger.register({ id: 'a', name: 'A', type: 'general' });

    expect(ledger.settle('a', 'completed')).toBe(true);
    expect(ledger.settle('a', 'failed')).toBe(false);
    expect(ledger.view('a')?.status).toBe('completed');
  });

  test('结算不存在/已注销条目：返回 false 且不抛错', () => {
    const ledger = makeLedger();
    expect(ledger.settle('ghost', 'failed')).toBe(false);
    ledger.register({ id: 'a', name: 'A', type: 'general' });
    ledger.settle('a', 'completed');
    expect(ledger.settle('a', 'completed')).toBe(false);
  });
});

describe('AgentRunLedger：两段式台账与归因（O2-4）', () => {
  test('结算后条目移入归因表，状态仍可查且不占并发槽位', () => {
    const ledger = makeLedger();
    ledger.register({ id: 'a', name: 'A', type: 'general' });
    ledger.settle('a', 'completed');

    expect(ledger.listActive()).toHaveLength(0);
    expect(ledger.recentCount()).toBe(1);
    expect(ledger.view('a')?.status).toBe('completed');
    expect(ledger.view('unknown')).toBeUndefined();
  });

  test('归因表 CAP 生效：超出上限按写入顺序淘汰最旧', () => {
    const ledger = makeLedger(2);
    for (const id of ['a', 'b', 'c']) {
      ledger.register({ id, name: id, type: 'general' });
      ledger.settle(id, 'completed');
    }

    expect(ledger.recentCount()).toBe(2);
    expect(ledger.view('a')).toBeUndefined(); // 最旧被淘汰
    expect(ledger.view('b')?.status).toBe('completed');
    expect(ledger.view('c')?.status).toBe('completed');
  });

  // R1 修复（2026-09-25）：归因表 CAP 淘汰与"终态副作用认领"解耦 ——
  // 修复前认领只查 active ?? recent，条目被淘汰即返回 null ⇒
  // 磁盘行永久 running + yield 结算通知静默跳过（与 M-5 同症候）。
  test('R1：条目被归因表 CAP 淘汰后仍可认领终态副作用（不静默丢结算）', () => {
    const ledger = makeLedger(1);
    ledger.register({
      id: 'a',
      name: 'A',
      type: 'general',
      sessionId: 'sess-a',
    });
    ledger.settle('a', 'completed');
    // 溢出淘汰：b 结算后最旧的 a 被移出归因表（CAP 语义保持不变）
    ledger.register({ id: 'b', name: 'B', type: 'general' });
    ledger.settle('b', 'completed');
    expect(ledger.view('a')).toBeUndefined();

    expect(ledger.claimTerminalSideEffects('a')).toEqual({
      status: 'completed',
      sessionId: 'sess-a',
    });
    // 幂等：已认领过（欠账表一条出口）⇒ 二次认领返回 null
    expect(ledger.claimTerminalSideEffects('a')).toBeNull();
  });
});

describe('AgentRunLedger：只读投影（O3/O10a②）', () => {
  test('查询返回新建对象且不外泄 sessionId；改写返回值不影响台账', () => {
    const ledger = makeLedger();
    ledger.register({
      id: 'a',
      name: 'A',
      type: 'general',
      sessionId: 's1',
    });

    const listed = ledger.listActive();
    expect(listed).toHaveLength(1);
    expect(Object.keys(listed[0])).not.toContain('sessionId');

    listed[0].status = 'failed';
    listed[0].name = 'tampered';
    expect(ledger.viewActive('a')?.status).toBe('running');
    expect(ledger.viewActive('a')?.name).toBe('A');

    // 两次查询互不共享对象
    expect(ledger.listActive()[0]).not.toBe(ledger.listActive()[0]);
  });
});

describe('AgentRunLedger：取消中间态（O10a③）', () => {
  test('受理取消 ⇒ cancel_requested（非终态，仍占槽位），随后可按真实终态落定', () => {
    const ledger = makeLedger();
    ledger.register({ id: 'a', name: 'A', type: 'general' });

    expect(ledger.requestCancel('a')).toBe(true);
    expect(ledger.view('a')?.status).toBe('cancel_requested');
    expect(ledger.liveCount()).toBe(1); // 引擎尚未收敛 ⇒ 额度不提前释放

    // 真实收敛后落终态（取消受理不等于"确定没跑成"，故此处仍可为 completed）
    expect(ledger.settle('a', 'completed')).toBe(true);
    expect(ledger.view('a')?.status).toBe('completed');
    expect(ledger.liveCount()).toBe(0);
  });

  test('取消幂等：重复受理返回 true（不重复迁移）；已终态/不存在返回 false', () => {
    const ledger = makeLedger();
    ledger.register({ id: 'a', name: 'A', type: 'general' });

    expect(ledger.requestCancel('a')).toBe(true);
    expect(ledger.requestCancel('a')).toBe(true);
    expect(ledger.requestCancel('ghost')).toBe(false);

    ledger.settle('a', 'failed');
    expect(ledger.requestCancel('a')).toBe(false);
  });
});

describe('运行状态机（B3 显式化）', () => {
  test('终态判定：completed / failed 为终态，running / cancel_requested 为非终态', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('cancel_requested')).toBe(false);
  });

  test('合法迁移：running → cancel_requested，及非终态 → 终态', () => {
    expect(canTransition('running', 'cancel_requested')).toBe(true);
    expect(canTransition('running', 'completed')).toBe(true);
    expect(canTransition('running', 'failed')).toBe(true);
    expect(canTransition('cancel_requested', 'completed')).toBe(true);
    expect(canTransition('cancel_requested', 'failed')).toBe(true);
  });

  test('非法迁移：终态不可改写、取消不可撤销、不可回到 running', () => {
    expect(canTransition('completed', 'failed')).toBe(false);
    expect(canTransition('failed', 'completed')).toBe(false);
    expect(canTransition('cancel_requested', 'running')).toBe(false);
    expect(canTransition('completed', 'running')).toBe(false);
  });

  test('台账迁移受状态机约束：取消受理后仍可落真实终态', () => {
    const ledger = makeLedger();
    ledger.register({ id: 'a', name: 'A', type: 'general' });
    ledger.requestCancel('a');

    // "取消受理"≠"确定没跑成" ⇒ 仍可由执行路径落 completed/failed
    expect(ledger.settle('a', 'failed')).toBe(true);
    expect(ledger.view('a')?.status).toBe('failed');
    // 终态后再 settle 被状态机拒绝
    expect(ledger.settle('a', 'completed')).toBe(false);
  });
});
