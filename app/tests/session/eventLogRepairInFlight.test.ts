/**
 * 崩溃修复不得给「在飞会话」合成 canceled closer（2026-10-31 口径 A）
 *
 * 真机取证：`session_mvmabftweb74e8df2e` 的 turn 25 于 19:31 开始、**19:53 被合成
 * `turn/end canceled`**（另一读者触发首读修复）、19:55 才真实 `turn/end tool_use` ⇒ 双 end。
 *
 * 口径：本进程内**仍在窗口内**的未闭合轮 ⇒ 跳过合成；进程崩溃后登记表随进程消失 ⇒
 * 下次启动照常修复。超过 60 分钟的未闭合轮按**泄漏**处理（异常中断未写 end），允许合成。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventLogStorage } from '../../src/session/storage/EventLogStorage';
import {
  hasRecentInFlightTurn,
  trackTurnLifecycle,
} from '../../src/session/storage/EventLogRepair';
import type { LiriEvent } from '@modules/session/types/events';

const HASH = 'default';
const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

function makeStorage(sessionId: string): {
  storage: EventLogStorage;
  dir: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'evtlog-inflight-'));
  createdDirs.push(dir);
  // `ensureSessionDir()` 不重建已删除会话目录 ⇒ 先建目录，append 才会真正落盘
  mkdirSync(join(dir, HASH, sessionId), { recursive: true });
  return { storage: new EventLogStorage(sessionId, HASH, dir), dir };
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
    sessionId: 'inflight',
    data: data as never,
  };
}

function eventsPath(dir: string, sessionId: string): string {
  return join(dir, HASH, sessionId, 'events.jsonl');
}

function lineCount(file: string): number {
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== '').length;
}

describe('崩溃修复：在飞会话不合成 closer', () => {
  it('刚写入 turn/start（本进程在飞）⇒ 不合成、文件不变', async () => {
    const { storage, dir } = makeStorage('inflight-a');
    await storage.append(ev(1, 'turn/start', { turn: 1, callSeq: 1 }));
    const file = eventsPath(dir, 'inflight-a');
    const before = lineCount(file);

    expect(await storage.commitInterruptedRepair()).toBe(0);
    expect(lineCount(file)).toBe(before);
  });

  it('turn/end 落盘后登记清除 ⇒ 无未闭合轮，同样不合成', async () => {
    const { storage, dir } = makeStorage('inflight-b');
    await storage.append(ev(1, 'turn/start', { turn: 1, callSeq: 1 }));
    await storage.append(ev(2, 'turn/end', { turn: 1, finishReason: 'stop' }));
    const file = eventsPath(dir, 'inflight-b');
    const before = lineCount(file);

    expect(await storage.commitInterruptedRepair()).toBe(0);
    expect(lineCount(file)).toBe(before);
  });

  it('未闭合轮超过 60 分钟 ⇒ 视为泄漏，不再算"在飞"', () => {
    // 用注入的 `now` 验证窗口语义（不依赖时间 mock）：真等 60 分钟不现实
    trackTurnLifecycle('inflight-c', { type: 'turn/start', data: { turn: 7 } });
    expect(hasRecentInFlightTurn('inflight-c', Date.now())).toBe(true);
    expect(
      hasRecentInFlightTurn('inflight-c', Date.now() + 61 * 60 * 1000)
    ).toBe(false);
  });

  it('在飞时 torn-tail 截断仍照做（两件事互不阻断）', async () => {
    const { storage, dir } = makeStorage('inflight-d');
    await storage.append(ev(1, 'turn/start', { turn: 1, callSeq: 1 }));
    const file = eventsPath(dir, 'inflight-d');
    appendFileSync(file, '{"type":"assistant/tex', 'utf-8');
    const before = lineCount(file);

    expect(await storage.commitTornRepair()).toBe(true);
    expect(lineCount(file)).toBe(before - 1); // 只截掉半写尾行，不新增 closer
    expect(await storage.commitInterruptedRepair()).toBe(0);
    expect(lineCount(file)).toBe(before - 1);
  });
});
