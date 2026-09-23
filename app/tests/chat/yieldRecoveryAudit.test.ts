// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B4-1 验收：恢复通路（认领 / 恢复 / 放弃）**入审计且可回放**（方案 §5-B4-1）
 *
 * 通道复用结论：既有**会话级可回放通道** = 会话事件日志（`events.jsonl`），
 * 事件类型 `agent/recovery`（§1.6 三处同批登记）。本文件用**真实 `EventLogStorage`**
 * 写入临时目录（不触碰 ~/.pyapp），再从盘上**按序读出**重建"这次恢复发生了什么"——
 * 即"可回放"的验收口径：不是断言"日志里有一行字"，而是断言**结构字段可判定 + 顺序可重建**。
 *
 * 覆盖：
 * - 恢复成功 ⇒ 认领 + 恢复（两条，`resumed`）；
 * - 恢复失败（handler 返回 ok:false）⇒ 认领 + 放弃（两条，`abandoned` + 原因）；
 * - 恢复抛错 ⇒ 同"放弃"，原因取异常文本；
 * - 已触发但未记账 ⇒ 认领 + 恢复（`failed` + `not_recorded`）；
 * - 未装配追加器 ⇒ **如实不落**（不伪造、不抛错）。
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { EventLogStorage } from '../../src/session/storage/EventLogStorage';
import type { LiriEvent } from '../../src/chat/types/events';
import {
  handleYieldSettlement,
  recordYieldRecovery,
  setSettlementCrashHookForTest,
  setYieldRecoveryAuditSink,
  setYieldResumeHandler,
  yieldSettlementListeners,
  type YieldResumerDeps,
} from '../../src/chat/yield';
import { getYieldRegistry, resetYieldRegistry } from '../../src/session/yield';

const SESSION = 'sess-b4-1';
const WORKTREE = 'wt-b4-1';

let roots: string[] = [];

function makeLog(): { log: EventLogStorage; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'yield-audit-'));
  roots.push(root);
  return { log: new EventLogStorage(SESSION, WORKTREE, root), root };
}

/** 新实例读同一盘（证明"可从**持久层**读出"，不是读内存） */
function reopenLog(root: string): EventLogStorage {
  return new EventLogStorage(SESSION, WORKTREE, root);
}

/** 读端重建的轨迹（结构字段，按 `seq` 升序 —— 即事件发生的顺序） */
interface RecoveryTraceRow {
  seq: number;
  action: string;
  outcome: string;
  turn?: number;
  toolCallId?: string;
  restored?: boolean;
  error?: string;
}

async function readTrace(log: EventLogStorage): Promise<RecoveryTraceRow[]> {
  const events = await log.read({ types: ['agent/recovery'], limit: 100 });
  return events.map((e: LiriEvent) => {
    const d = e.data as {
      action: string;
      outcome: string;
      turn?: number;
      toolCallId?: string;
      restored?: boolean;
      error?: string;
    };
    return {
      seq: e.seq,
      action: d.action,
      outcome: d.outcome,
      ...(d.turn !== undefined ? { turn: d.turn } : {}),
      ...(d.toolCallId !== undefined ? { toolCallId: d.toolCallId } : {}),
      ...(d.restored !== undefined ? { restored: d.restored } : {}),
      ...(d.error !== undefined ? { error: d.error } : {}),
    };
  });
}

function deps(): YieldResumerDeps {
  return { hasActiveRuns: () => false, latestTurn: () => 5 };
}

function seedWaiting(toolCallId = 'c-b41'): void {
  getYieldRegistry().register({
    sessionId: SESSION,
    turn: 5,
    toolCallId,
    yieldedAt: 100,
  });
}

beforeEach(() => {
  resetYieldRegistry();
  setYieldResumeHandler(null);
  setYieldRecoveryAuditSink(null);
  setSettlementCrashHookForTest(null);
});

afterEach(() => {
  resetYieldRegistry();
  setYieldResumeHandler(null);
  setYieldRecoveryAuditSink(null);
  setSettlementCrashHookForTest(null);
  yieldSettlementListeners.length = 0;
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      // @ignore-catch — 临时目录清理失败不影响断言
    }
  }
  roots = [];
});

describe('B4-1：恢复事件入审计（会话事件通道，可回放）', () => {
  test('恢复成功 ⇒ 认领 + 恢复两条，从盘上按序重建', async () => {
    const { log, root } = makeLog();
    setYieldRecoveryAuditSink((sid, event) => log.append(event));
    seedWaiting();
    setYieldResumeHandler(async () => ({ ok: true }));

    expect(
      await handleYieldSettlement({ sessionId: SESSION, endedAt: 200 }, deps())
    ).toBe(true);

    // 用**新实例**从同一盘读回（持久层证据，而非内存）
    const trace = await readTrace(reopenLog(root));
    expect(trace.map((r) => [r.action, r.outcome])).toEqual([
      ['claim', 'claimed'],
      ['resume', 'resumed'],
    ]);
    // 结构字段可判定：归属（toolCallId/turn）与回放标记都在
    expect(trace[0]).toMatchObject({ turn: 5, toolCallId: 'c-b41' });
    expect(trace[1]).toMatchObject({ turn: 5, toolCallId: 'c-b41' });
    // seq 严格递增 ⇒ 顺序即动作顺序（"可回放"的排序依据）
    expect(trace[1].seq).toBeGreaterThan(trace[0].seq);
  });

  test('恢复失败（handler ok:false）⇒ 认领 + 放弃，原因入字段', async () => {
    const { log, root } = makeLog();
    setYieldRecoveryAuditSink((sid, event) => log.append(event));
    seedWaiting();
    setYieldResumeHandler(async () => ({ ok: false, error: 'boom' }));

    expect(
      await handleYieldSettlement({ sessionId: SESSION, endedAt: 200 }, deps())
    ).toBe(false);

    const trace = await readTrace(reopenLog(root));
    expect(trace.map((r) => [r.action, r.outcome])).toEqual([
      ['claim', 'claimed'],
      ['abandon', 'abandoned'],
    ]);
    expect(trace[1].error).toBe('boom');
  });

  test('恢复抛错 ⇒ 放弃 + 异常文本（不吞原因）', async () => {
    const { log, root } = makeLog();
    setYieldRecoveryAuditSink((sid, event) => log.append(event));
    seedWaiting();
    setYieldResumeHandler(async () => {
      throw new Error('resume-exploded');
    });

    expect(
      await handleYieldSettlement({ sessionId: SESSION, endedAt: 200 }, deps())
    ).toBe(false);

    const trace = await readTrace(reopenLog(root));
    expect(trace.map((r) => [r.action, r.outcome])).toEqual([
      ['claim', 'claimed'],
      ['abandon', 'abandoned'],
    ]);
    expect(trace[1].error).toContain('resume-exploded');
  });

  test('已触发恢复但未记账 ⇒ 恢复记 failed + not_recorded（不虚报成功）', async () => {
    const { log, root } = makeLog();
    setYieldRecoveryAuditSink((sid, event) => log.append(event));
    seedWaiting('c-old');
    setYieldResumeHandler(async () => {
      // 恢复在飞行期间该会话发生新一轮 yield ⇒ 原登记引用失效
      getYieldRegistry().register({
        sessionId: SESSION,
        turn: 6,
        toolCallId: 'c-new',
        yieldedAt: 150,
      });
      return { ok: true };
    });

    expect(
      await handleYieldSettlement({ sessionId: SESSION, endedAt: 200 }, deps())
    ).toBe(false);

    const trace = await readTrace(reopenLog(root));
    expect(trace.map((r) => [r.action, r.outcome])).toEqual([
      ['claim', 'claimed'],
      ['resume', 'failed'],
    ]);
    expect(trace[1].error).toBe('not_recorded');
  });

  test('回放投递 ⇒ 认领/恢复记录带 restored 标记', async () => {
    const { log, root } = makeLog();
    setYieldRecoveryAuditSink((sid, event) => log.append(event));
    seedWaiting();
    setYieldResumeHandler(async () => ({ ok: true }));

    await handleYieldSettlement(
      { sessionId: SESSION, endedAt: 200, restored: true },
      deps()
    );

    const trace = await readTrace(reopenLog(root));
    expect(trace.map((r) => r.restored)).toEqual([true, true]);
  });

  test('未装配追加器 ⇒ 不落事件（如实不落，不伪造、不抛错）', async () => {
    setYieldRecoveryAuditSink(null);
    await expect(
      recordYieldRecovery({
        sessionId: SESSION,
        action: 'claim',
        outcome: 'claimed',
      })
    ).resolves.toBeUndefined();
  });
});
