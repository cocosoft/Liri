/**
 * P10（2026-11-12）：`getMaxTurn` 的缓存必须随写入前进。
 *
 * 真机 `session_mwcyhmmpd44e93b602`：`turn/start` 写 turn=2，随后 `turn/end` 却写 turn=1
 * （6 次 start 只有 2 次 end，且同号 turn 被反复重开）。根因：`maxTurn` 只在首次扫描时赋值，
 * 写入 turn 事件后不更新 ⇒ 后续读到旧最大值，`turn/end` 取到过小的编号。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { EventLogStorage } from '../../src/session/storage/EventLogStorage';
import type { LiriEvent } from '@modules/session/types/events';

const HASH = 'default';
const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    try {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

function makeStore(sessionId: string): EventLogStorage {
  const root = mkdtempSync(join(tmpdir(), 'evtlog-maxturn-'));
  dirs.push(root);
  mkdirSync(join(root, HASH, sessionId), { recursive: true });
  return new EventLogStorage(sessionId, HASH, root);
}

function ev(
  seq: number,
  type: LiriEvent['type'],
  data: Record<string, unknown>
): LiriEvent {
  return {
    type: type as never,
    schemaVersion: 1,
    seq,
    time: 1700000000000 + seq * 1000,
    sessionId: 's1',
    data: data as never,
  };
}

describe('P10：getMaxTurn 缓存随写入前进', () => {
  it('写入 turn/start(turn=2) 后立刻读到 2（不再返回旧值 1）', async () => {
    const store = makeStore('max-turn-cache');

    await store.append(ev(0, 'turn/start', { turn: 1 }));
    await store.append(ev(0, 'turn/end', { turn: 1, finishReason: 'stop' }));
    expect(await store.getMaxTurn()).toBe(1);

    await store.append(ev(0, 'turn/start', { turn: 2 }));
    expect(await store.getMaxTurn()).toBe(2);
  });

  it('turn/end 写更小的号不会让缓存回退（防错位事件拉低最大值）', async () => {
    const store = makeStore('max-turn-no-regress');
    await store.append(ev(0, 'turn/start', { turn: 2 }));
    expect(await store.getMaxTurn()).toBe(2);

    await store.append(
      ev(0, 'turn/end', { turn: 1, finishReason: 'tool_use' })
    );
    expect(await store.getMaxTurn()).toBe(2);
  });
});
