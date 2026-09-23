// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B4-2 验收：恢复通路的 `loopProbe` 相位标签（`yield:*`）——方案 §5-B4-2
 *
 * 目标：**恢复期阻塞可归因**。`phaseStack` 的 `recentPhases()` / `snapshotPhases()`
 * → `renderSummaryMarkdown` 已逐条输出 phase 名（既有能力，U5 已核实）⇒
 * 本文件只需断言"恢复通路真的产生了这些相位"，且**顺序/嵌套**可判读。
 *
 * 覆盖：
 * - 回放（`replayPendingSettlements` 单条）⇒ `yield:replay` ⊃ `yield:claim`
 *   （台账认领）→ `yield:resume`（恢复执行器）→ `yield:state`（台账落定）；
 * - **失败路径**（未获 ack ⇒ `markFailed`）同样产生相位（不得只在成功路径插桩）；
 * - 探针关闭（`setPhaseStackEnabled(false)`）⇒ **不伪造相位**（沿用 `currentPhase()`
 *   返回 `null` 的既定口径）。
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { SettlementOutbox } from '../../src/chat/yield/SettlementOutbox';
import {
  replayPendingSettlements,
  setSettlementCrashHookForTest,
  setYieldRecoveryAuditSink,
  setYieldResumeHandler,
  yieldSettlementListeners,
  type YieldResumerDeps,
} from '../../src/chat/yield';
import { getYieldRegistry, resetYieldRegistry } from '../../src/session/yield';
import {
  currentPhase,
  recentPhases,
  resetPhaseStack,
  setPhaseStackEnabled,
} from '../../src/diagnostics/loopProbe/phaseStack';

/** Bun 运行时全局（tsc 类型面未声明 `gc`，按仓内既有约定就地声明） */
declare const Bun: { gc(force: boolean): void };

const SESSION = 's-b4-2-session';
let roots: string[] = [];
let opened: SettlementOutbox[] = [];

function makeOutbox(): SettlementOutbox {
  const root = mkdtempSync(join(tmpdir(), 'yield-phase-'));
  roots.push(root);
  const outbox = new SettlementOutbox(join(root, 'outbox.db'));
  opened.push(outbox);
  return outbox;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  resetYieldRegistry();
  setYieldResumeHandler(null);
  setYieldRecoveryAuditSink(null);
  setSettlementCrashHookForTest(null);
  setPhaseStackEnabled(true);
  resetPhaseStack();
});

afterEach(async () => {
  resetYieldRegistry();
  setYieldResumeHandler(null);
  setYieldRecoveryAuditSink(null);
  setSettlementCrashHookForTest(null);
  yieldSettlementListeners.length = 0;
  resetPhaseStack();
  setPhaseStackEnabled(true);
  while (opened.length > 0) opened.pop()!.close();
  // 删临时库前强制 GC：预编译语句未终结时 sqlite close 只是"僵尸化"连接，文件句柄仍被占
  Bun.gc(true);
  for (const r of roots) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        rmSync(r, { recursive: true, force: true });
        break;
      } catch {
        // @ignore-catch — 句柄尚未释放：退避后重试
        await sleep(25);
      }
    }
  }
  roots = [];
});

function deps(): YieldResumerDeps {
  return { hasActiveRuns: () => false, latestTurn: () => 5 };
}

function seedWaiting(): void {
  getYieldRegistry().register({
    sessionId: SESSION,
    turn: 5,
    toolCallId: 'c-b42',
    yieldedAt: 1000,
  });
}

describe('B4-2：恢复通路相位标签（yield:*）', () => {
  test('回放一条（成功）⇒ yield:replay ⊃ claim → resume → state', async () => {
    const outbox = makeOutbox();
    await outbox.enqueue({ sessionId: SESSION, endedAt: 2000 });
    seedWaiting();
    setYieldResumeHandler(async () => ({ ok: true }));
    resetPhaseStack();

    expect(await replayPendingSettlements(deps(), outbox)).toBe(1);

    // recentPhases 为"新→旧"⇒ 反序即完成顺序：claim → resume → state → replay
    expect(recentPhases().map((p) => p.name)).toEqual([
      'yield:replay',
      'yield:state',
      'yield:resume',
      'yield:claim',
    ]);
  });

  test('回放一条（未获 ack ⇒ markFailed）同样产生相位（失败路径不缺席）', async () => {
    const outbox = makeOutbox();
    await outbox.enqueue({ sessionId: SESSION, endedAt: 2000 });
    // 不登记等待 ⇒ 判定不可恢复 ⇒ ack=false ⇒ markFailed
    setYieldResumeHandler(async () => ({ ok: true }));
    resetPhaseStack();

    expect(await replayPendingSettlements(deps(), outbox)).toBe(0);

    const names = recentPhases().map((p) => p.name);
    expect(names).toContain('yield:replay');
    expect(names).toContain('yield:claim');
    expect(names).toContain('yield:state');
  });

  test('恢复执行器抛错（放弃路径）⇒ yield:resume 相位仍闭合（不悬挂栈）', async () => {
    const outbox = makeOutbox();
    await outbox.enqueue({ sessionId: SESSION, endedAt: 2000 });
    seedWaiting();
    setYieldResumeHandler(async () => {
      throw new Error('boom');
    });
    resetPhaseStack();

    expect(await replayPendingSettlements(deps(), outbox)).toBe(0);

    const names = recentPhases().map((p) => p.name);
    expect(names).toContain('yield:resume');
    // withPhase 的 finally 语义：异常路径也必须退出相位（否则栈悬挂 ⇒ 归因错误）
    expect(currentPhase()).toBeNull();
  });

  test('探针关闭 ⇒ 不伪造相位（currentPhase() 为 null、recentPhases() 为空）', async () => {
    const outbox = makeOutbox();
    await outbox.enqueue({ sessionId: SESSION, endedAt: 2000 });
    seedWaiting();
    setYieldResumeHandler(async () => ({ ok: true }));
    setPhaseStackEnabled(false);

    expect(await replayPendingSettlements(deps(), outbox)).toBe(1);

    expect(recentPhases()).toHaveLength(0);
    expect(currentPhase()).toBeNull();
  });
});
