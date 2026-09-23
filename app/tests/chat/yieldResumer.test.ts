/**
 * YieldResumer / YieldSettlementBridge 测试（阶段 A / A1-d-settle + A1-e）
 *
 * 覆盖：
 * - 判定链：无等待 / 结算早于登记 / turn 已取代 / 仍有活跃 run ⇒ 均不恢复
 * - 正常：判定通过 + handler 注入 ⇒ 触发恢复并收敛（登记被清除、落 resumed 终态）
 * - 失败降级：handler 返回失败 ⇒ 等待被作废（不永久停留等待态）
 * - 未装配 handler ⇒ 保持等待且不误收敛
 * - `installYieldResumer`：结算通知驱动恢复；卸载后不再响应
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  getYieldRegistry,
  resetYieldRegistry,
  YIELD_STATUS_RESUMED,
} from '../../src/session/yield';
import {
  handleYieldSettlement,
  setYieldResumeHandler,
  hasYieldResumeHandler,
  installYieldResumer,
  yieldSettlementListeners,
  notifyYieldSettled,
  type YieldResumerDeps,
} from '../../src/chat/yield';

function makeDeps(
  over: Partial<{
    hasActiveRuns: (sessionId: string) => boolean;
    latestTurn: () => number;
  }> = {}
): YieldResumerDeps {
  return {
    hasActiveRuns: over.hasActiveRuns ?? (() => false),
    latestTurn: over.latestTurn ?? (() => 5),
  };
}

/** 轮询等待条件成立（监听器内部为异步处理） */
async function waitUntil(
  check: () => boolean,
  timeoutMs = 1000
): Promise<void> {
  const start = Date.now();
  while (!check() && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('YieldResumer（A1-e 恢复判定与收敛）', () => {
  beforeEach(() => {
    resetYieldRegistry();
    setYieldResumeHandler(null);
  });

  afterEach(() => {
    resetYieldRegistry();
    setYieldResumeHandler(null);
    yieldSettlementListeners.length = 0;
  });

  test('无等待条目 ⇒ 不恢复', async () => {
    let called = false;
    setYieldResumeHandler(async () => {
      called = true;
      return { ok: true };
    });
    expect(
      await handleYieldSettlement({ sessionId: 's1', endedAt: 100 }, makeDeps())
    ).toBe(false);
    expect(called).toBe(false);
  });

  test('判定通过 ⇒ 触发恢复并收敛（落 resumed 终态）', async () => {
    const registry = getYieldRegistry();
    const entry = registry.register({
      sessionId: 's1',
      turn: 5,
      toolCallId: 'c1',
      yieldedAt: 100,
    });

    let received: { sessionId: string; toolCallId: string } | null = null;
    setYieldResumeHandler(async (params) => {
      received = {
        sessionId: params.sessionId,
        toolCallId: params.toolCallId,
      };
      return { ok: true };
    });

    expect(
      await handleYieldSettlement(
        { sessionId: 's1', endedAt: 200 },
        makeDeps({ latestTurn: () => 5 })
      )
    ).toBe(true);
    expect(received).toEqual({ sessionId: 's1', toolCallId: 'c1' });
    expect(registry.isWaiting('s1')).toBe(false);
    expect(entry.status).toBe(YIELD_STATUS_RESUMED);
  });

  test('结算早于登记 ⇒ 忽略（不恢复、仍等待）', async () => {
    const registry = getYieldRegistry();
    registry.register({
      sessionId: 's1',
      turn: 5,
      toolCallId: 'c1',
      yieldedAt: 500,
    });
    let called = false;
    setYieldResumeHandler(async () => {
      called = true;
      return { ok: true };
    });

    expect(
      await handleYieldSettlement(
        { sessionId: 's1', endedAt: 100 },
        makeDeps({ latestTurn: () => 5 })
      )
    ).toBe(false);
    expect(called).toBe(false);
    expect(registry.isWaiting('s1')).toBe(true);
  });

  test('turn 已被后续轮次取代 ⇒ 不恢复', async () => {
    const registry = getYieldRegistry();
    registry.register({
      sessionId: 's1',
      turn: 5,
      toolCallId: 'c1',
      yieldedAt: 100,
    });
    setYieldResumeHandler(async () => ({ ok: true }));

    expect(
      await handleYieldSettlement(
        { sessionId: 's1', endedAt: 200 },
        makeDeps({ latestTurn: () => 6 })
      )
    ).toBe(false);
    expect(registry.isWaiting('s1')).toBe(true);
  });

  test('仍有活跃子代理 run ⇒ 继续等待', async () => {
    const registry = getYieldRegistry();
    registry.register({
      sessionId: 's1',
      turn: 5,
      toolCallId: 'c1',
      yieldedAt: 100,
    });
    setYieldResumeHandler(async () => ({ ok: true }));

    expect(
      await handleYieldSettlement(
        { sessionId: 's1', endedAt: 200 },
        makeDeps({ hasActiveRuns: () => true, latestTurn: () => 5 })
      )
    ).toBe(false);
    expect(registry.isWaiting('s1')).toBe(true);
  });

  test('hasActiveRuns 按会话取值 —— 其他会话的在途 run 不阻塞本会话恢复', async () => {
    const registry = getYieldRegistry();
    registry.register({
      sessionId: 's1',
      turn: 5,
      toolCallId: 'c1',
      yieldedAt: 100,
    });
    setYieldResumeHandler(async () => ({ ok: true }));

    const seen: string[] = [];
    expect(
      await handleYieldSettlement(
        { sessionId: 's1', endedAt: 200 },
        makeDeps({
          hasActiveRuns: (sessionId) => {
            seen.push(sessionId);
            return sessionId !== 's1'; // 's2' 还有在途 run
          },
          latestTurn: () => 5,
        })
      )
    ).toBe(true);
    expect(seen).toEqual(['s1']);
    expect(registry.isWaiting('s1')).toBe(false);
  });

  test('结算落在「登记 → 收尾回填」窗口内（turn 仍为 0）⇒ 不判取代，可恢复', async () => {
    const registry = getYieldRegistry();
    registry.register({
      sessionId: 's1',
      turn: 0, // 收尾点尚未 updateTurn
      toolCallId: 'c1',
      yieldedAt: 100,
    });
    setYieldResumeHandler(async () => ({ ok: true }));

    expect(
      await handleYieldSettlement(
        { sessionId: 's1', endedAt: 200 },
        makeDeps({ latestTurn: () => 1 })
      )
    ).toBe(true);
    expect(registry.isWaiting('s1')).toBe(false);
  });

  test('恢复失败 ⇒ 等待被作废（不永久停留等待态）', async () => {
    const registry = getYieldRegistry();
    registry.register({
      sessionId: 's1',
      turn: 5,
      toolCallId: 'c1',
      yieldedAt: 100,
    });
    setYieldResumeHandler(async () => ({ ok: false, error: 'boom' }));

    expect(
      await handleYieldSettlement(
        { sessionId: 's1', endedAt: 200 },
        makeDeps({ latestTurn: () => 5 })
      )
    ).toBe(false);
    expect(registry.isWaiting('s1')).toBe(false);
  });

  test('未装配 handler ⇒ 保持等待（既不 resolve 也不 abandon）', async () => {
    const registry = getYieldRegistry();
    registry.register({
      sessionId: 's1',
      turn: 5,
      toolCallId: 'c1',
      yieldedAt: 100,
    });
    expect(hasYieldResumeHandler()).toBe(false);

    expect(
      await handleYieldSettlement(
        { sessionId: 's1', endedAt: 200 },
        makeDeps({ latestTurn: () => 5 })
      )
    ).toBe(false);
    expect(registry.isWaiting('s1')).toBe(true);
  });

  test('installYieldResumer：结算通知驱动恢复；卸载后不再响应', async () => {
    const registry = getYieldRegistry();
    registry.register({
      sessionId: 's1',
      turn: 5,
      toolCallId: 'c1',
      yieldedAt: 100,
    });
    setYieldResumeHandler(async () => ({ ok: true }));

    const uninstall = installYieldResumer(makeDeps({ latestTurn: () => 5 }));
    const listenerCount = yieldSettlementListeners.length;
    expect(listenerCount).toBeGreaterThan(0);

    notifyYieldSettled({ sessionId: 's1', endedAt: 200 });
    await waitUntil(() => !registry.isWaiting('s1'));
    expect(registry.isWaiting('s1')).toBe(false);

    uninstall();
    expect(yieldSettlementListeners.length).toBe(listenerCount - 1);
  });
});

/**
 * B1-1（P0-1 / I1）：并发结算的**单胜者**语义。
 *
 * 修复前 `handleYieldSettlement` 的判定→恢复临界区跨 2 个 `await`
 * （`await latestTurn` + `await resumeHandler`），且无 in-flight 去重标记
 * ⇒ 两路并行批次结算各自通过判定、各自调 `resumeHandler`：
 * **父会话被恢复两次、起两个并发 turn**。
 *
 * 修复后：`YieldRegistry.claim()` 是**无 await 的同步 CAS**，只有一路能认领成功。
 */
describe('YieldResumer：B1-1 并发结算单胜者', () => {
  beforeEach(() => {
    resetYieldRegistry();
    setYieldResumeHandler(null);
  });

  afterEach(() => {
    resetYieldRegistry();
    setYieldResumeHandler(null);
    yieldSettlementListeners.length = 0;
  });

  test('两路并发结算 ⇒ resumeHandler 恰好调用 1 次', async () => {
    const registry = getYieldRegistry();
    registry.register({
      sessionId: 's1',
      turn: 5,
      toolCallId: 'c1',
      yieldedAt: 100,
    });

    let calls = 0;
    setYieldResumeHandler(async () => {
      calls += 1;
      // 制造在飞行窗口：让第二路在认领已被占后仍能跑到判定
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ok: true };
    });

    const [first, second] = await Promise.all([
      handleYieldSettlement(
        { sessionId: 's1', endedAt: 200 },
        makeDeps({ latestTurn: () => 5 })
      ),
      handleYieldSettlement(
        { sessionId: 's1', endedAt: 200 },
        makeDeps({ latestTurn: () => 5 })
      ),
    ]);

    expect(calls).toBe(1); // 修复前为 2
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(registry.isWaiting('s1')).toBe(false);
  });

  test('认领失败一律不触发 handler（引用不等 / 非 waiting）', async () => {
    const registry = getYieldRegistry();
    const stale = registry.register({
      sessionId: 's1',
      turn: 5,
      toolCallId: 'c-old',
      yieldedAt: 100,
    });
    // 同会话被新一轮 yield 覆盖 ⇒ 旧引用的认领必须被拒
    registry.register({
      sessionId: 's1',
      turn: 6,
      toolCallId: 'c-new',
      yieldedAt: 150,
    });

    expect(registry.claim('s1', stale)).toBe(false);
    expect(registry.claim('s1')).toBe(true); // 新条目可被认领
    expect(registry.get('s1')).toBeUndefined(); // 认领后不再可见（防二次认领）
    expect(registry.claim('s1')).toBe(false);
  });
});

/**
 * B1-2（P0-3）：`registry.resolve()` 的返回值**必须判定**。
 *
 * 修复前：恢复 handler 返回 ok 即 `return true`（`resolve()` 返回值被丢弃）⇒ 调用方
 * `markDelivered` ⇒ "重放不再兜底 + 日志撒谎"。本用例锁定"已触发但未真正记账 ⇒ 不得报成功"。
 */
describe('YieldResumer：B1-2 未记账不得报成功', () => {
  beforeEach(() => {
    resetYieldRegistry();
    setYieldResumeHandler(null);
  });

  afterEach(() => {
    resetYieldRegistry();
    setYieldResumeHandler(null);
    yieldSettlementListeners.length = 0;
  });

  test('恢复期间登记被新一轮 yield 取代 ⇒ 未记账 ⇒ 返回 false 且保留新等待', async () => {
    const registry = getYieldRegistry();
    registry.register({
      sessionId: 's1',
      turn: 5,
      toolCallId: 'c-old',
      yieldedAt: 100,
    });

    setYieldResumeHandler(async () => {
      // 恢复在飞行期间，该会话发生新一轮 yield ⇒ 原登记引用失效（resolve 必被拒）
      registry.register({
        sessionId: 's1',
        turn: 6,
        toolCallId: 'c-new',
        yieldedAt: 150,
      });
      return { ok: true };
    });

    const ok = await handleYieldSettlement(
      { sessionId: 's1', endedAt: 200 },
      makeDeps({ latestTurn: () => 5 })
    );

    // 修复前：`resolve()` 返回值被丢弃 ⇒ 此处为 true（虚报成功 ⇒ 调用方 markDelivered）
    expect(ok).toBe(false);
    // 未被记账 ≠ 静默丢弃：新登记仍在等待（交回放重投）
    expect(registry.isWaiting('s1')).toBe(true);
  });
});
