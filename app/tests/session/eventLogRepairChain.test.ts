// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * D4 撕裂修复链单测（TB-10「仍开放」第 2、3 项，2026-09-23）
 *
 * 覆盖 `EventLogStorage` 的崩溃修复链（此前**无直接单测**）：
 *  1. `scanForTornTail()` 尾部撕裂检测（半写尾行 ⇒ torn + 正确截断偏移）
 *  2. `commitTornRepair()` **真截断写盘**（读回文件验证行数与内容 + tailSeq 重算）
 *  3. `interruptedTurnClosers()` / `commitInterruptedRepair()` 未闭合轮次合成
 *     turn/end 并**真落盘**
 *  4. KB-TORN-PRESERVE / KB-TORN-CUT：可解析但无换行的尾行不被误截（锁住既有修复）
 *  5. 修复告警节流（2026-09-23 新增）：冷却窗内不重复告警、窗外再次告警，
 *     且节流**只作用于告警、不影响修复写盘**
 *
 * 说明：临时目录 harness 复用 `EventLogStorage.test.ts` 的 `sessionsRoot` 注入方式
 *（构造参数 3 = 会话根目录），绝不写真实 `~/.pyapp`。
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { getLogger } from '@modules/monitoring';
import { EventLogStorage } from '../../src/session/storage/EventLogStorage';
import type { LiriEvent } from '../../src/chat/types/events';

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
  const dir = mkdtempSync(join(tmpdir(), 'evtlog-repair-'));
  createdDirs.push(dir);
  // 第 3 个构造参数 sessionsRoot ⇒ 路径 = join(sessionsRoot, worktreeHash, sessionId)
  const storage = new EventLogStorage(sessionId, HASH, dir);
  return { storage, dir };
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

function lineOf(e: LiriEvent): string {
  return JSON.stringify(e) + '\n';
}

function sessionDir(dir: string, sessionId: string): string {
  return join(dir, HASH, sessionId);
}

function eventsPath(dir: string, sessionId: string): string {
  return join(sessionDir(dir, sessionId), 'events.jsonl');
}

/** 写入原始 events.jsonl 内容（可为撕裂/半写形态） */
function writeRaw(dir: string, sessionId: string, raw: string): void {
  const sd = sessionDir(dir, sessionId);
  mkdirSync(sd, { recursive: true });
  writeFileSync(eventsPath(dir, sessionId), raw, 'utf-8');
}

function readRaw(dir: string, sessionId: string): string {
  return readFileSync(eventsPath(dir, sessionId), 'utf-8');
}

/** 读回文件的非空行（验证"真落盘"用） */
function readLines(dir: string, sessionId: string): string[] {
  return readRaw(dir, sessionId)
    .split('\n')
    .filter((l) => l.trim().length > 0);
}

type WarnFn = (message: string, meta?: unknown) => void;

/**
 * 临时把 `session:event-log` 单例 logger 的 warn 换成计数器（对齐
 * `PdcaLauncher-progress.test.ts` 的既有做法：getLogger 按 module 名返回共享单例），
 * 只统计本文件关心的修复类告警，其余 warn 原样忽略。
 */
async function withRepairWarnSpy<T>(
  fn: (warnCount: () => number) => Promise<T>
): Promise<T> {
  const target = getLogger('session:event-log') as unknown as { warn: WarnFn };
  const original = target.warn;
  let count = 0;
  target.warn = ((message: string) => {
    if (
      message.includes('torn tail 已截断修复') ||
      message.includes('崩溃恢复合成 turn/end closers')
    ) {
      count++;
    }
  }) as WarnFn;
  try {
    return await fn(() => count);
  } finally {
    target.warn = original;
  }
}

/** 修复告警节流字段（私有；断言节流状态机用） */
type RepairThrottleState = { lastRepairAlertAt: number };

describe('D4 撕裂修复链（EventLogStorage）', () => {
  const e1 = ev(1, 'user/message', { content: 'a', messageId: 'm1' });
  const e2 = ev(2, 'assistant/text', { content: 'b', messageId: 'm2' });
  const completeTwoLines = lineOf(e1) + lineOf(e2);
  /** 半写尾行：JSON 不完整（崩溃点） */
  const halfLine = '{"type":"assistant/text","seq":3,"se';

  it('① scanForTornTail：半写尾行 ⇒ torn=true 且 offset=最后一个完整行末字节', async () => {
    const { storage, dir } = makeStorage('torn-scan');
    writeRaw(dir, 'torn-scan', completeTwoLines + halfLine);

    const scan = await storage.scanForTornTail();

    expect(scan.torn).toBe(true);
    // 截断偏移 = 两条完整行（含换行）的字节数
    expect(scan.offset).toBe(Buffer.byteLength(completeTwoLines, 'utf-8'));
    expect(scan.offset).toBeLessThan(
      Buffer.byteLength(completeTwoLines + halfLine, 'utf-8')
    );
  });

  it('② commitTornRepair：文件真被截断（读回验证）+ tailSeq 重算', async () => {
    const { storage, dir } = makeStorage('torn-repair');
    writeRaw(dir, 'torn-repair', completeTwoLines + halfLine);
    const rawBefore = readRaw(dir, 'torn-repair');

    const repaired = await storage.commitTornRepair();

    expect(repaired).toBe(true);
    const rawAfter = readRaw(dir, 'torn-repair');
    expect(rawAfter).toBe(completeTwoLines); // 半写行被真实删除
    expect(rawAfter.length).toBeLessThan(rawBefore.length);
    expect(readLines(dir, 'torn-repair').length).toBe(2);
    // tailSeq 重算为截断后的真实最大 seq
    expect(await storage.getTailSeq()).toBe(2);
    // 读取路径拿到的是修复后的完整事件
    const events = await storage.read();
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('③ 未闭合轮次：interruptedTurnClosers 产出 cancelled closer 且 commitInterruptedRepair 真落盘', async () => {
    const { storage, dir } = makeStorage('turn-repair');
    writeRaw(
      dir,
      'turn-repair',
      lineOf(ev(1, 'turn/start', { turn: 1 })) +
        lineOf(ev(2, 'user/message', { content: 'hi', messageId: 'm1' })) +
        lineOf(ev(3, 'assistant/text', { content: 'partial', messageId: 'm1' }))
    );

    // 检测：只有 turn/start 无配对 turn/end
    const { closers, openTurns } = await storage.interruptedTurnClosers();
    expect(openTurns).toEqual([1]);
    expect(closers.length).toBe(1);
    expect(closers[0].type).toBe('turn/end');
    expect(closers[0].seq).toBe(4); // 当前 tailSeq(3) + 1
    expect(
      (closers[0].data as { turn: number; finishReason: string }).finishReason
    ).toBe('canceled');
    // 检测阶段不落盘
    expect(readLines(dir, 'turn-repair').length).toBe(3);

    // 落盘：真写入合成事件
    const written = await storage.commitInterruptedRepair();
    expect(written).toBe(1);
    const lines = readLines(dir, 'turn-repair');
    expect(lines.length).toBe(4);
    const last = JSON.parse(lines[3]) as LiriEvent;
    expect(last.type).toBe('turn/end');
    expect((last.data as { turn: number }).turn).toBe(1);
    expect((last.data as { finishReason: string }).finishReason).toBe(
      'canceled'
    );
    // 读回事件流含合成 closer
    const events = await storage.read();
    expect(events.map((e) => e.type)).toEqual([
      'turn/start',
      'user/message',
      'assistant/text',
      'turn/end',
    ]);
    // 修复后不再有未闭合轮次（幂等）
    expect((await storage.interruptedTurnClosers()).openTurns).toEqual([]);
  });

  it('④ KB-TORN-PRESERVE：可解析但无换行的尾行不被误截', async () => {
    const { storage, dir } = makeStorage('torn-preserve');
    const e3 = ev(3, 'user/message', { content: 'c', messageId: 'm3' });
    // 第 3 行 JSON 完整、仅缺末尾换行符（外部工具/异常落盘的假阳性形态）
    const raw = lineOf(e1) + lineOf(e2) + JSON.stringify(e3);
    writeRaw(dir, 'torn-preserve', raw);

    const scan = await storage.scanForTornTail();
    // 依据实现 2038-2047 行（KB-TORN-PRESERVE）：可解析尾行整条保留
    expect(scan.torn).toBe(false);
    expect(scan.offset).toBe(Buffer.byteLength(raw, 'utf-8'));

    expect(await storage.commitTornRepair()).toBe(false);
    expect(readRaw(dir, 'torn-preserve')).toBe(raw); // 文件未被截断
    const events = await storage.read();
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(readRaw(dir, 'torn-preserve')).toBe(raw); // 读取路径也未被误截
  });

  it('⑤ 完整文件（每行均以换行结尾）不误判 torn（KB-TORN-CUT 反向保护）', async () => {
    const { storage, dir } = makeStorage('torn-clean');
    writeRaw(dir, 'torn-clean', completeTwoLines);

    const scan = await storage.scanForTornTail();

    expect(scan.torn).toBe(false);
    expect(scan.offset).toBe(Buffer.byteLength(completeTwoLines, 'utf-8'));
    expect(await storage.commitTornRepair()).toBe(false);
    expect(readRaw(dir, 'torn-clean')).toBe(completeTwoLines);
  });

  it('⑥ 修复告警冷却：冷却窗内不重复告警，窗外再次告警', async () => {
    const { storage, dir } = makeStorage('cooldown-a');
    const state = storage as unknown as RepairThrottleState;
    const torn = completeTwoLines + halfLine;

    await withRepairWarnSpy(async (warnCount) => {
      writeRaw(dir, 'cooldown-a', torn);
      expect(await storage.commitTornRepair()).toBe(true);
      expect(warnCount()).toBe(1); // 窗外：告警一次
      const firstAlertAt = state.lastRepairAlertAt;
      expect(firstAlertAt).toBeGreaterThan(0);

      // 同一份损坏再次被读取（重新落回撕裂态）⇒ 冷却窗内不再告警
      writeRaw(dir, 'cooldown-a', torn);
      expect(await storage.commitTornRepair()).toBe(true); // 修复照常
      expect(warnCount()).toBe(1); // 告警未增加
      expect(state.lastRepairAlertAt).toBe(firstAlertAt); // 时间戳未推进 ⇒ 走了冷却分支

      // 窗口过期（回拨时间戳，避免真等 60s）⇒ 恢复告警
      const staleAt = Date.now() - 61_000;
      state.lastRepairAlertAt = staleAt;
      writeRaw(dir, 'cooldown-a', torn);
      expect(await storage.commitTornRepair()).toBe(true);
      expect(warnCount()).toBe(2);
      expect(state.lastRepairAlertAt).toBeGreaterThan(staleAt);
    });
  });

  it('⑦ 修复告警冷却：同实例内 closers 告警与撕裂告警共用窗口，且节流不影响写盘', async () => {
    const { storage, dir } = makeStorage('cooldown-b');
    // 同一份损坏同时含：半写尾行 + 未闭合 turn ⇒ 两次修复都会告警
    const torn =
      lineOf(ev(1, 'turn/start', { turn: 1 })) +
      lineOf(ev(2, 'user/message', { content: 'hi', messageId: 'm1' })) +
      '{"type":"assistant/tex';

    await withRepairWarnSpy(async (warnCount) => {
      writeRaw(dir, 'cooldown-b', torn);
      expect(await storage.commitTornRepair()).toBe(true); // 告警 1（撕裂）
      expect(warnCount()).toBe(1);

      // 冷却窗内：closers 告警被降级，但修复本身照常落盘
      const written = await storage.commitInterruptedRepair();
      expect(written).toBe(1);
      expect(warnCount()).toBe(1);
      const lines = readLines(dir, 'cooldown-b');
      expect(lines.length).toBe(3);
      expect((JSON.parse(lines[2]) as LiriEvent).type).toBe('turn/end');
    });
  });

  // 附加：appendFileSync 追加（跨实例/半写交织的真实形态）也不改变撕裂判定语义
  it('⑧ 完整文件后追加半写行（append-only 路径）⇒ 仍判定 torn 并只截掉半写行', async () => {
    const { storage, dir } = makeStorage('torn-append');
    writeRaw(dir, 'torn-append', completeTwoLines);
    appendFileSync(eventsPath(dir, 'torn-append'), halfLine, 'utf-8');

    const scan = await storage.scanForTornTail();
    expect(scan.torn).toBe(true);
    expect(scan.offset).toBe(Buffer.byteLength(completeTwoLines, 'utf-8'));
    expect(await storage.commitTornRepair()).toBe(true);
    expect(readRaw(dir, 'torn-append')).toBe(completeTwoLines);
  });
});
