/**
 * 结算回放测试（方案 O8：ack + 启动回放接线）
 *
 * 锁定：回放按台账重投；**收到 ack ⇒ delivered**、未获 ack ⇒ `failed`（仍可再回放）；
 * 且回放投递带 `restored: true`（避免重复恢复被误认为首次）。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import { getYieldRegistry, resetYieldRegistry } from '../../src/session/yield';
import {
  setYieldResumeHandler,
  handleYieldSettlement,
  replayPendingSettlements,
} from '../../src/chat/yield';
import { SettlementOutbox } from '../../src/chat/yield/SettlementOutbox';

let outbox: SettlementOutbox;
let dbPath: string;

beforeEach(async () => {
  resetYieldRegistry();
  dbPath = join(tmpdir(), `replay-${randomUUID().slice(0, 8)}.db`);
  outbox = new SettlementOutbox(dbPath);
  await outbox.init();
});

afterEach(() => {
  outbox.close();
  resetYieldRegistry();
  setYieldResumeHandler(null);
  try {
    unlinkSync(dbPath);
  } catch {
    // @ignore-catch — 清理临时文件失败不影响断言
  }
});

const deps = { hasActiveRuns: () => false, latestTurn: () => 5 };

describe('replayPendingSettlements（O8 回放）', () => {
  test('有等待登记 + 恢复成功 ⇒ ack ⇒ 台账转 delivered，返回 1', async () => {
    const registry = getYieldRegistry();
    registry.register({
      sessionId: 's1',
      turn: 5,
      toolCallId: 'c1',
      yieldedAt: 100,
    });
    const seenReasons: string[] = [];
    setYieldResumeHandler(async ({ reason }) => {
      seenReasons.push(reason);
      return { ok: true };
    });
    const id = await outbox.enqueue({ sessionId: 's1', endedAt: 200 });

    const delivered = await replayPendingSettlements(deps, outbox);

    expect(delivered).toBe(1);
    expect((await outbox.getRow(id))?.state).toBe('delivered');
    // 回放投递带可见标记（restored）
    expect(seenReasons).toEqual(['subagents_settled_restored']);
  });

  test('无等待登记 ⇒ 未获 ack ⇒ 台账转 failed（可再回放）', async () => {
    setYieldResumeHandler(async () => ({ ok: true }));
    const id = await outbox.enqueue({ sessionId: 'no-wait', endedAt: 200 });

    const delivered = await replayPendingSettlements(deps, outbox);

    expect(delivered).toBe(0);
    const row = await outbox.getRow(id);
    expect(row?.state).toBe('failed');
    expect(row?.attempts).toBe(1);
    // 仍属可回放集合（区别于 dropped）
    expect(await outbox.listReplayable()).toHaveLength(1);
  });

  test('首次投递（非回放）的 reason 不带 restored 标记', async () => {
    const registry = getYieldRegistry();
    registry.register({
      sessionId: 's2',
      turn: 5,
      toolCallId: 'c2',
      yieldedAt: 100,
    });
    const seenReasons: string[] = [];
    setYieldResumeHandler(async ({ reason }) => {
      seenReasons.push(reason);
      return { ok: true };
    });

    const ack = await handleYieldSettlement(
      { sessionId: 's2', endedAt: 200 },
      deps
    );

    expect(ack).toBe(true);
    expect(seenReasons).toEqual(['subagents_settled']);
  });
});
