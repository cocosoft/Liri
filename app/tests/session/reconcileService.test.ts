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
 * ReconcileService 检测逻辑单测（TB-10「仍开放」第 1 项，2026-09-23）
 *
 * 背景：TB-10 主体（对账队列无消费触发点）修复时只覆盖了**接线**
 *（`app/tests/chat/reconcileDrain.test.ts`），`ReconcileService` 的 5 类漂移检测
 * 与"默认只告警不写盘"契约本身**无直接单测**。本文件补齐。
 *
 * 覆盖：
 *  ① eventsDamaged（坏行）—— 只提示不反向补全（以投影为准）
 *  ② event-missing（投影有·事件无）—— 漂移 + backfillCandidates + 反向补全计划
 *  ③ projection-missing（事件有·投影无）—— events 为准
 *  ④ content-mismatch（事件 text 与投影 content 不一致）
 *  ⑤ compaction-half-state（压缩半状态）
 *  ⑥ 修剪缺口排除（落在 trajectoryTrims 区间内的缺口不报；对照无 trims 时上报）
 *  ⑦ sinceSeq 增量对账（只报该 seq 之后的漂移）
 *  ⑧ 无漂移 ⇒ ok=true 且 repairPlan 为空
 *  ①/⑧ 并锁定**默认只告警不写盘**（未调用任何写方法 + 原 events.jsonl 字节不变）
 *
 * deps 提供方式：**内存实现**（真实事件/投影/meta 结构），不用 mock 返回空值 ——
 * 检测逻辑依赖 seq / data.messageId / lastEventSeq 的真实形态，假值会让断言
 * "自己造结论"（CS04/CS06）。写方法一律为记录桩，被调用即契约破坏。
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { LiriEvent } from '../../src/chat/types/events';
import { ReconcileService } from '../../src/session/reconcile/ReconcileService';
import type { ReconcileDeps } from '../../src/session/reconcile/ReconcileService';
import type { DerivedMessage } from '../../src/session/storage/EventMessageDeriver';
import type { EventLogStorage } from '../../src/session/storage/EventLogStorage';

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

/**
 * 内存事件日志：形态照 `ReconcileDeps.getEventLog` 的**真实用法**
 * （ReconcileService 只调 `getFilePath()` 与 `read()`）。
 *
 * 写方法为记录桩：ReconcileService 的契约是「默认只检测 + 告警 + 修复计划，不写盘」，
 * 任何写方法被调用都是契约破坏 —— 记录调用名并抛错（不静默返回造出来的成功值）。
 */
class InMemoryEventLog {
  readonly writeCalls: string[] = [];
  readCalls = 0;

  constructor(
    private readonly path: string,
    private readonly events: LiriEvent[]
  ) {}

  getFilePath(): string {
    return this.path;
  }

  async read(): Promise<LiriEvent[]> {
    this.readCalls++;
    return this.events;
  }

  /** 写方法桩的统一入口：记录 + 抛错（契约破坏点立刻可见） */
  recordWrite(name: string): never {
    this.writeCalls.push(name);
    throw new Error(
      `ReconcileService 契约：默认只检测不写盘，不得调用 ${name}()`
    );
  }

  async append(): Promise<never> {
    return this.recordWrite('append');
  }
  async appendBatch(): Promise<never> {
    return this.recordWrite('appendBatch');
  }
  async trimEvents(): Promise<never> {
    return this.recordWrite('trimEvents');
  }
  async commitTornRepair(): Promise<never> {
    return this.recordWrite('commitTornRepair');
  }
  async commitInterruptedRepair(): Promise<never> {
    return this.recordWrite('commitInterruptedRepair');
  }
}

/** 写真实 raw 文件：ReconcileService 的坏行检测直接 fs.readFile(getFilePath()) */
function rawLogFile(sessionId: string, raw: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-'));
  createdDirs.push(dir);
  const sessionDir = join(dir, HASH, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const path = join(sessionDir, 'events.jsonl');
  writeFileSync(path, raw, 'utf-8');
  return path;
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

/** 投影消息（messages.jsonl 形态：含 lastEventSeq 版本戳） */
function projMsg(
  id: string,
  lastEventSeq: number,
  content: string,
  role: 'user' | 'assistant' = 'assistant'
): DerivedMessage {
  return {
    id,
    role,
    content,
    timestamp: 1700000000000 + lastEventSeq * 1000,
    lastEventSeq,
  };
}

/** 构造 deps：注入内存实现（无 mock 返回空值） */
function makeDeps(
  log: InMemoryEventLog,
  projections: DerivedMessage[],
  meta?: Record<string, unknown>
): ReconcileDeps {
  return {
    // ReconcileService 只用到 EventLogStorage 的 getFilePath/read；
    // EventLogStorage 带 private 字段（名义类型）⇒ 结构类型不可直接赋值，显式转换
    getEventLog: () => log as unknown as EventLogStorage,
    getProjections: async () => projections,
    getSessionMeta: async () => meta,
  };
}

function expectNoWrite(log: InMemoryEventLog): void {
  expect(log.writeCalls).toEqual([]);
}

describe('ReconcileService 漂移检测（TB-10 仍开放项 1）', () => {
  it('① eventsDamaged：坏行 ⇒ 报警且不产出反向补全候选（以投影为准）', async () => {
    const sessionId = 'rc-damaged';
    const e1 = ev(1, 'user/message', { content: 'hi', messageId: 'm1' });
    const e2 = ev(2, 'assistant/text', { content: 'hello', messageId: 'm2' });
    // raw 文件 3 行 = 2 条有效事件 + 1 条半写坏行；read() 只返回 2 条有效事件
    const rawPath = rawLogFile(
      sessionId,
      lineOf(e1) + lineOf(e2) + '{"type":"assistant/text","seq":3'
    );
    const rawBefore = readFileSync(rawPath, 'utf-8');
    const log = new InMemoryEventLog(rawPath, [e1, e2]);
    const deps = makeDeps(log, [
      projMsg('m1', 1, 'hi', 'user'),
      projMsg('m2', 2, 'hello'),
      projMsg('m3', 3, 'orphan-projection'),
    ]);

    const report = await new ReconcileService(deps).reconcileSession(sessionId);

    expect(report.ok).toBe(false);
    // 损坏场景下所有漂移都是 event-missing 语义（以投影为准）
    expect(report.drifts.every((d) => d.kind === 'event-missing')).toBe(true);
    const damage = report.drifts.find((d) => d.detail.includes('坏行'));
    expect(damage).toBeDefined();
    expect(damage!.messageId).toBe('');
    expect(damage!.detail).toContain('events 损坏');
    // 事件流损坏 ⇒ 只提示不补全
    expect(report.backfillCandidates).toEqual([]);
    const m3 = report.drifts.find((d) => d.messageId === 'm3');
    expect(m3!.detail).toContain('事件日志已损坏');
    expect(report.repairPlan.some((p) => p.includes('待人工评估'))).toBe(true);

    // 只读不写：读 1 次、未调用任何写方法、原文件字节不变
    expect(log.readCalls).toBe(1);
    expectNoWrite(log);
    expect(readFileSync(rawPath, 'utf-8')).toBe(rawBefore);
  });

  it('② event-missing：投影有·事件无 ⇒ 漂移 + backfillCandidates + 反向补全计划', async () => {
    const sessionId = 'rc-event-missing';
    const e1 = ev(1, 'user/message', { content: 'hi', messageId: 'm1' });
    const e2 = ev(2, 'assistant/text', { content: 'hello', messageId: 'm2' });
    // raw 行数 = 有效事件数 ⇒ badLineCount=0（非损坏）
    const rawPath = rawLogFile(sessionId, lineOf(e1) + lineOf(e2));
    const log = new InMemoryEventLog(rawPath, [e1, e2]);
    const deps = makeDeps(log, [
      projMsg('m1', 1, 'hi', 'user'),
      projMsg('m2', 2, 'hello'),
      projMsg('m3', 3, 'orphan-projection'),
    ]);

    const report = await new ReconcileService(deps).reconcileSession(sessionId);

    expect(report.ok).toBe(false);
    expect(report.drifts.length).toBe(1);
    expect(report.drifts[0].kind).toBe('event-missing');
    expect(report.drifts[0].messageId).toBe('m3');
    expect(report.drifts[0].detail).toContain('events 半写，需反向补全');
    expect(report.backfillCandidates).toEqual([
      { messageId: 'm3', lastEventSeq: 3 },
    ]);
    expect(report.repairPlan.some((p) => p.includes('反向补全'))).toBe(true);
    expectNoWrite(log);
  });

  it('③ projection-missing：事件有·投影无 ⇒ 漂移（events 为准待重建投影）', async () => {
    const sessionId = 'rc-projection-missing';
    const e1 = ev(1, 'user/message', { content: 'hi', messageId: 'm1' });
    const e2 = ev(2, 'assistant/text', {
      content: 'no-projection',
      messageId: 'm2',
    });
    const rawPath = rawLogFile(sessionId, lineOf(e1) + lineOf(e2));
    const log = new InMemoryEventLog(rawPath, [e1, e2]);
    const deps = makeDeps(log, [projMsg('m1', 1, 'hi', 'user')]);

    const report = await new ReconcileService(deps).reconcileSession(sessionId);

    expect(report.ok).toBe(false);
    expect(report.drifts.length).toBe(1);
    expect(report.drifts[0].kind).toBe('projection-missing');
    expect(report.drifts[0].messageId).toBe('m2');
    expect(report.drifts[0].detail).toContain('lastEventSeq=2');
    expect(report.repairPlan.some((p) => p.includes('投影缺失'))).toBe(true);
    // 事件有投影无不是"反向补全"场景
    expect(report.backfillCandidates).toEqual([]);
    expectNoWrite(log);
  });

  it('④ content-mismatch：事件 text 与投影 content 不一致 ⇒ 漂移', async () => {
    const sessionId = 'rc-content-mismatch';
    const e1 = ev(1, 'user/message', { content: 'hi', messageId: 'm1' });
    const e2 = ev(2, 'assistant/text', {
      content: 'event-side-content',
      messageId: 'm2',
    });
    const rawPath = rawLogFile(sessionId, lineOf(e1) + lineOf(e2));
    const log = new InMemoryEventLog(rawPath, [e1, e2]);
    const deps = makeDeps(log, [
      projMsg('m1', 1, 'hi', 'user'),
      // m2 投影版本戳(1) < 事件 maxChunkSeq(2) ⇒ 派生取事件侧正文，与投影正文不一致
      projMsg('m2', 1, 'proj-stub'),
    ]);

    const report = await new ReconcileService(deps).reconcileSession(sessionId);

    expect(report.ok).toBe(false);
    expect(report.drifts.length).toBe(1);
    expect(report.drifts[0].kind).toBe('content-mismatch');
    expect(report.drifts[0].messageId).toBe('m2');
    expect(report.drifts[0].detail).toContain('不一致');
    // 有漂移 ⇒ repairPlan 非空（无可编排项时回落"待人工评估"）
    expect(report.repairPlan.length).toBeGreaterThan(0);
    expectNoWrite(log);
  });

  it('⑤ compaction-half-state：投影仍含压缩区间内消息 ⇒ 半状态漂移', async () => {
    const sessionId = 'rc-compaction-half';
    const e1 = ev(1, 'user/message', { content: 'a', messageId: 'm1' });
    const e2 = ev(2, 'assistant/text', { content: 'b', messageId: 'm2' });
    const rawPath = rawLogFile(sessionId, lineOf(e1) + lineOf(e2));
    const log = new InMemoryEventLog(rawPath, [e1, e2]);
    const deps = makeDeps(
      log,
      [projMsg('m1', 1, 'a', 'user'), projMsg('m2', 2, 'b')],
      {
        trajectoryCompactions: [
          {
            startSeq: 1,
            endSeq: 2,
            summary: '压缩摘要',
            summaryMessageId: 'sum-1',
          },
        ],
      }
    );

    const report = await new ReconcileService(deps).reconcileSession(sessionId);

    expect(report.ok).toBe(false);
    expect(report.drifts.length).toBe(1);
    expect(report.drifts[0].kind).toBe('compaction-half-state');
    expect(report.drifts[0].messageId).toBe('sum-1');
    expect(report.drifts[0].detail).toContain('压缩区间 [1,2]');
    expect(report.repairPlan.some((p) => p.includes('压缩半状态自愈'))).toBe(
      true
    );
    expectNoWrite(log);
  });

  it('⑥ 修剪缺口排除：落在 trajectoryTrims 区间的缺口不报（对照：无 trims 时上报）', async () => {
    const sessionId = 'rc-trim-gap';
    const rawPath = rawLogFile(sessionId, '');
    const log = new InMemoryEventLog(rawPath, []);
    const projections = [projMsg('m9', 9, 'trimmed-out')];

    // 有 trims：[5,10] 覆盖 seq=9 ⇒ 合法缺口，不报
    const withTrims = await new ReconcileService(
      makeDeps(log, projections, {
        trajectoryTrims: [{ startSeq: 5, endSeq: 10 }],
      })
    ).reconcileSession(sessionId);
    expect(withTrims.ok).toBe(true);
    expect(withTrims.drifts).toEqual([]);
    expect(withTrims.backfillCandidates).toEqual([]);
    expect(withTrims.repairPlan).toEqual([]);

    // 对照：同样输入、无 trims ⇒ 上报 event-missing + 反向补全候选
    const withoutTrims = await new ReconcileService(
      makeDeps(log, projections)
    ).reconcileSession(sessionId);
    expect(withoutTrims.ok).toBe(false);
    expect(withoutTrims.drifts.length).toBe(1);
    expect(withoutTrims.drifts[0].kind).toBe('event-missing');
    expect(withoutTrims.backfillCandidates).toEqual([
      { messageId: 'm9', lastEventSeq: 9 },
    ]);
    expectNoWrite(log);
  });

  it('⑦ sinceSeq 增量对账：只报该 seq 之后的漂移', async () => {
    const sessionId = 'rc-since-seq';
    const e1 = ev(1, 'user/message', { content: 'hi', messageId: 'm1' });
    const rawPath = rawLogFile(sessionId, lineOf(e1));
    const log = new InMemoryEventLog(rawPath, [e1]);
    const deps = makeDeps(log, [
      projMsg('m1', 1, 'hi', 'user'),
      projMsg('m2', 2, 'late-orphan'),
    ]);
    const service = new ReconcileService(deps);

    // 全量：m2 无事件 ⇒ 漂移
    const full = await service.reconcileSession(sessionId);
    expect(full.ok).toBe(false);
    expect(full.drifts.map((d) => d.messageId)).toEqual(['m2']);

    // sinceSeq=2：m1(1) 与 m2(2) 均 <= 2 ⇒ 全部跳过，无漂移
    const skipped = await service.reconcileSession(sessionId, { sinceSeq: 2 });
    expect(skipped.ok).toBe(true);
    expect(skipped.drifts).toEqual([]);

    // sinceSeq=1：只跳过 m1，m2(2>1) 仍上报
    const partial = await service.reconcileSession(sessionId, { sinceSeq: 1 });
    expect(partial.ok).toBe(false);
    expect(partial.drifts.map((d) => d.messageId)).toEqual(['m2']);
    expectNoWrite(log);
  });

  it('⑧ 无漂移 ⇒ ok=true、drifts/backfill 为空、repairPlan 为空（且未写盘）', async () => {
    const sessionId = 'rc-clean';
    const e1 = ev(1, 'user/message', { content: 'hi', messageId: 'm1' });
    const e2 = ev(2, 'assistant/text', { content: 'hello', messageId: 'm2' });
    const rawPath = rawLogFile(sessionId, lineOf(e1) + lineOf(e2));
    const rawBefore = readFileSync(rawPath, 'utf-8');
    const log = new InMemoryEventLog(rawPath, [e1, e2]);
    const deps = makeDeps(log, [
      projMsg('m1', 1, 'hi', 'user'),
      projMsg('m2', 2, 'hello'),
    ]);

    const report = await new ReconcileService(deps).reconcileSession(sessionId);

    expect(report.ok).toBe(true);
    expect(report.sessionId).toBe(sessionId);
    expect(report.drifts).toEqual([]);
    expect(report.backfillCandidates).toEqual([]);
    expect(report.repairPlan).toEqual([]);
    expect(log.readCalls).toBe(1);
    expectNoWrite(log);
    expect(readFileSync(rawPath, 'utf-8')).toBe(rawBefore);
  });
});
