// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// fork 前置判据的**分页读**回归测试（2026-10-16，台账 FORK-PREFIX-WINDOW）
//
// 背景（真机双探针实证）：
//   - `sess_001` fork `boundary=1029` ⇒ 400 `open turn at seq 925 blocks fork boundary 1029`，
//     而文件里 `seq=1029` 的 `turn/end` 明明闭合了 turn 9；
//   - `session_muwdzb4ei28xb3eqad` 目标 `@1169`（事件**确实存在**）⇒ 400
//     `truncate-before message not in event log`。
// 共同根因：`EventLogStorage.read()` 的 `limit` **缺省 1000**（内部夹到 ≤10000），
// 原实现拿这个截断窗口做「未闭合轮次 / 边界解析 / 前缀同构」三项判据，而 boundary 用真实 tailSeq。
//
// 本文件直接对 `session/gateway/ForkBoundary.ts` 的三个判据做单元级验证：
//   1. `findOpenTurnInPrefix` —— 已闭合的长前缀**不得**误报；boundary 切在轮内**必须**报
//   2. `resolveBoundaryBeforeMessage` —— 目标落在 1000 之外仍能解析；不存在才返回 null
//   3. `comparePrefixIsomorphic` —— 长前缀逐条比对（窗口外差异**必须**被发现）

import { describe, expect, it, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { EventLogStorage } from '../../src/session/storage/EventLogStorage';
import {
  comparePrefixIsomorphic,
  findOpenTurnInPrefix,
  resolveBoundaryBeforeMessage,
} from '../../src/session/gateway/ForkBoundary';
import type { LiriEvent, LiriEventType } from '@modules/session/types/events';

const WORKTREE_HASH = 'testhash';
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'fork-paging-'));
});

afterEach(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // 清理失败不影响断言
  }
});

function makeEvent(
  seq: number,
  sessionId: string,
  type: LiriEventType,
  data: Record<string, unknown> = {}
): LiriEvent {
  return {
    type,
    schemaVersion: 1,
    seq,
    time: 1700000000000 + seq * 1000,
    sessionId,
    data,
  };
}

function writeLog(sessionId: string, events: LiriEvent[]): EventLogStorage {
  const dir = join(dataDir, 'sessions', WORKTREE_HASH, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'events.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf-8'
  );
  return new EventLogStorage(
    sessionId,
    WORKTREE_HASH,
    join(dataDir, 'sessions')
  );
}

/**
 * 每轮 5 条：`user → turn/start → text → metric → turn/end`，前置 1 条噪声事件
 * ⇒ 第 r 轮 user=5r-3、turn/start=5r-2、turn/end=5r+1；`[1..1000]` 恰含 turn/start(998) 不含其 end(1001)。
 */
function longEvents(
  sessionId: string,
  rounds: number
): { events: LiriEvent[]; userIds: string[] } {
  const events: LiriEvent[] = [makeEvent(1, sessionId, 'metric/timing', {})];
  const userIds: string[] = [];
  let seq = 1;
  for (let r = 1; r <= rounds; r++) {
    const mid = `lu${r}`;
    userIds.push(mid);
    events.push(
      makeEvent(++seq, sessionId, 'user/message', {
        content: `第${r}问`,
        messageId: mid,
      })
    );
    events.push(makeEvent(++seq, sessionId, 'turn/start', { turn: r }));
    events.push(
      makeEvent(++seq, sessionId, 'assistant/text-batch', {
        content: `第${r}答`,
        messageId: `la${r}`,
      })
    );
    events.push(makeEvent(++seq, sessionId, 'metric/timing', {}));
    events.push(
      makeEvent(++seq, sessionId, 'turn/end', { turn: r, finishReason: 'stop' })
    );
  }
  return { events, userIds };
}

describe('findOpenTurnInPrefix：按 boundary 分页读全前缀', () => {
  it('已闭合的长前缀（1501 条，窗口右端落在轮内）⇒ 不误报', async () => {
    const sid = 'fp-open-closed';
    const log = writeLog(sid, longEvents(sid, 300).events);

    // 边界取真实尾部（1501）—— 旧实现只看 [1..1000]，会把 turn/start(998) 误判为未闭合
    expect(await findOpenTurnInPrefix(log, 1501)).toBeNull();
  });

  it('boundary 切在未闭合轮内 ⇒ 报出该 turn/start', async () => {
    const sid = 'fp-open-open';
    const events: LiriEvent[] = [
      makeEvent(1, sid, 'user/message', { content: '甲', messageId: 'm1' }),
      makeEvent(2, sid, 'turn/start', { turn: 1 }),
      makeEvent(3, sid, 'assistant/text-batch', {
        content: '甲答',
        messageId: 'a1',
      }),
      makeEvent(4, sid, 'turn/end', { turn: 1, finishReason: 'stop' }),
      // 第 2 轮只有 turn/start（未闭合）
      makeEvent(5, sid, 'user/message', { content: '乙', messageId: 'm2' }),
      makeEvent(6, sid, 'turn/start', { turn: 2 }),
      makeEvent(7, sid, 'assistant/text-batch', {
        content: '乙答',
        messageId: 'a2',
      }),
    ];
    const log = writeLog(sid, events);

    expect(await findOpenTurnInPrefix(log, 4)).toBeNull();
    const open = await findOpenTurnInPrefix(log, 7);
    expect(open?.seq).toBe(6);
    expect(open?.turn).toBe(2);
  });
});

describe('resolveBoundaryBeforeMessage：分页扫描（目标可在窗口之外）', () => {
  it('目标 seq=1497（远超 1000）⇒ 边界 = 上一轮 turn/end(1496)', async () => {
    const sid = 'fp-resolve-long';
    const { events, userIds } = longEvents(sid, 300);
    const log = writeLog(sid, events);

    expect(await resolveBoundaryBeforeMessage(log, userIds[299])).toBe(1496);
    // 首轮编辑 ⇒ 之前无已闭合轮次 ⇒ 0（零种子）
    expect(await resolveBoundaryBeforeMessage(log, userIds[0])).toBe(0);
  });

  it('目标不在事件日志 ⇒ null（不猜测边界）', async () => {
    const sid = 'fp-resolve-missing';
    const log = writeLog(sid, longEvents(sid, 5).events);

    expect(await resolveBoundaryBeforeMessage(log, 'not-exist')).toBeNull();
  });
});

describe('comparePrefixIsomorphic：长前缀逐条比对', () => {
  const ROUNDS = 240; // tail = 5*240+1 = 1201 > 1000

  it('两侧一致（1201 条）⇒ ok', async () => {
    const src = longEvents('fp-iso-src', ROUNDS).events;
    const sourceLog = writeLog('fp-iso-src', src);
    const childLog = writeLog(
      'fp-iso-child',
      src.map((e) => ({ ...e }))
    );

    expect(await comparePrefixIsomorphic(sourceLog, childLog, 1201)).toEqual({
      ok: true,
    });
  });

  it('窗口之外（index≈1100）内容漂移 ⇒ 必须发现', async () => {
    const src = longEvents('fp-iso2-src', ROUNDS).events;
    const sourceLog = writeLog('fp-iso2-src', src);
    const drifted = src.map((e) => ({ ...e }));
    // 改第 1100 条（index 1099）的 data —— 旧实现两侧都只读 1000 条，此差异**看不见**
    drifted[1099] = {
      ...drifted[1099],
      data: { ...(drifted[1099].data as object), content: '被并发改写' },
    };
    const childLog = writeLog('fp-iso2-child', drifted);

    const result = await comparePrefixIsomorphic(sourceLog, childLog, 1201);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('data[1099] mismatch');
  });

  it('子会话前缀更短（截在轮边界）⇒ 判否（ended early）', async () => {
    const src = longEvents('fp-iso3-src', ROUNDS).events;
    const sourceLog = writeLog('fp-iso3-src', src);
    // 子会话只到第 200 轮结束（seq=5*200+1=1001，恰为 turn/end ⇒ 轮次闭合，不触发修复合成）
    const short = src.slice(0, 1001).map((e) => ({ ...e }));
    const childLog = writeLog('fp-iso3-child', short);

    const result = await comparePrefixIsomorphic(sourceLog, childLog, 1201);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('ended early');
  });

  /**
   * 反向说明（真实行为）：若子会话缺的是**最后一条 `turn/end`**，`EventLogStorage` 的
   * D4 崩溃修复会在首次读取时合成一条 `turn/end{canceled}`（seq = tail+1）⇒ 两侧条数相同
   * 但内容不同 ⇒ 判否的 detail 是 `data[...] mismatch` 而非 `ended early`。
   */
  it('子会话末条 turn/end 被替换为修复合成的 canceled ⇒ 仍判否（内容漂移）', async () => {
    const src = longEvents('fp-iso4-src', ROUNDS).events;
    const sourceLog = writeLog('fp-iso4-src', src);
    const childLog = writeLog(
      'fp-iso4-child',
      src.slice(0, -1).map((e) => ({ ...e }))
    );

    const result = await comparePrefixIsomorphic(sourceLog, childLog, 1201);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('data[1200] mismatch');
  });
});
