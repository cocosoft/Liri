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
  over: Partial<{ hasActiveRuns: () => boolean; latestTurn: () => number }> = {}
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
