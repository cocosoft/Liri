// MIT License
// Copyright (c) 2026 190615273@qq.com
// EventLogStorage 事件快照缓存单元测试（P1-2，2026-08-30）
// 覆盖 v3 方案 §六：命中过滤 / 增量扩展 / meta 滞后（P0-2）/ 跨实例 stale（P1-A）/ 冷却（P0-3）/
// 失效重建 / 超限（P1-B）/ IO 失败（P1-5）/ 损坏行两路径一致（P0-4）/ 扫描竞态（P1-A/P2-E）/ tailSeq 不回退（P0-1）

import { describe, expect, it, afterEach } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventLogStorage } from '../../src/session/storage/EventLogStorage';
import type { LiriEvent } from '../../src/chat/types/events';

const HASH = 'default';

/** 测试可访问的私有快照状态（避免使用 any） */
interface TestableSnapshotState {
  eventsSnapshot: LiriEvent[] | null;
  snapshotBytes: number;
  snapshotIneligible: boolean;
  snapshotCooldownUntil: number;
  tailSeq: number;
  tailSeqInitialized: boolean;
}

function expose(storage: EventLogStorage): TestableSnapshotState {
  return storage as unknown as TestableSnapshotState;
}

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

function makeStorage(
  sessionId: string,
  opts?: { maxEvents?: number; maxBytes?: number; hook?: () => Promise<void> }
): { storage: EventLogStorage; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'evtlog-'));
  createdDirs.push(dir);
  const storage = new EventLogStorage(
    sessionId,
    HASH,
    dir,
    opts?.maxEvents,
    opts?.maxBytes,
    opts?.hook
  );
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

function writeEvents(
  dir: string,
  sessionId: string,
  events: LiriEvent[]
): void {
  const sd = sessionDir(dir, sessionId);
  mkdirSync(sd, { recursive: true });
  writeFileSync(join(sd, 'events.jsonl'), events.map(lineOf).join(''), 'utf-8');
}

function writeRaw(dir: string, sessionId: string, raw: string): void {
  const sd = sessionDir(dir, sessionId);
  mkdirSync(sd, { recursive: true });
  writeFileSync(join(sd, 'events.jsonl'), raw, 'utf-8');
}

function eventsPath(dir: string, sessionId: string): string {
  return join(sessionDir(dir, sessionId), 'events.jsonl');
}

function metaPath(dir: string, sessionId: string): string {
  return join(sessionDir(dir, sessionId), 'events.tail');
}

describe('EventLogStorage 事件快照缓存（P1-2）', () => {
  it('快照命中过滤：fromSeq/types/excludeTypes/limit', async () => {
    const { storage, dir } = makeStorage('s1');
    writeEvents(dir, 's1', [
      ev(1, 'user/message', { content: 'hi', messageId: 'm1' }),
      ev(2, 'assistant/thinking', { content: 't', messageId: 'm2' }),
      ev(3, 'assistant/text', { content: 'x', messageId: 'm2' }),
      ev(4, 'tool/result', { toolCallId: 'tc', callSeq: 3, result: '{}' }),
    ]);
    const st = expose(storage);

    // 首次 read：fromSeq=1 → 建快照
    const all = await storage.read();
    expect(all.length).toBe(4);
    expect(st.eventsSnapshot?.length).toBe(4);
    expect(st.tailSeq).toBe(4);

    // 命中快照 + excludeTypes
    const excl = await storage.read({
      excludeTypes: ['assistant/thinking'],
    });
    expect(excl.map((e) => e.type)).toEqual([
      'user/message',
      'assistant/text',
      'tool/result',
    ]);
    // types 白名单
    const types = await storage.read({
      types: ['assistant/text', 'assistant/thinking'],
    });
    expect(types.length).toBe(2);
    // 分页续读（fromSeq>1）
    const paged = await storage.read({ fromSeq: 3, limit: 10 });
    expect(paged.map((e) => e.seq)).toEqual([3, 4]);
    // limit
    const limited = await storage.read({ limit: 2 });
    expect(limited.length).toBe(2);
  });

  it('append 增量扩展后命中快照（P1-B 守卫内）', async () => {
    const { storage, dir } = makeStorage('s2');
    writeEvents(dir, 's2', [
      ev(1, 'user/message', { content: 'a', messageId: 'm1' }),
    ]);
    const st = expose(storage);
    await storage.read();
    expect(st.eventsSnapshot?.length).toBe(1);

    await storage.append(
      ev(2, 'assistant/text', { content: 'b', messageId: 'm2' })
    );
    expect(st.eventsSnapshot?.length).toBe(2);
    expect(st.snapshotBytes).toBeGreaterThan(0);

    const all = await storage.read();
    expect(all.length).toBe(2);
    expect(st.eventsSnapshot).not.toBeNull();
  });

  it('meta 滞后（写失败模拟）仍 fresh（P0-2）', async () => {
    const { storage, dir } = makeStorage('s3');
    writeEvents(dir, 's3', [
      ev(1, 'user/message', { content: 'a', messageId: 'm1' }),
      ev(2, 'assistant/text', { content: 'b', messageId: 'm2' }),
    ]);
    await storage.read(); // 建快照 tail=2
    const st = expose(storage);
    expect(st.eventsSnapshot).not.toBeNull();

    // 模拟 meta 写失败：meta 停在旧值 1（< tail）
    writeFileSync(metaPath(dir, 's3'), '1', 'utf-8');

    const all = await storage.read();
    expect(all.length).toBe(2); // 不因 meta 滞后失效
    expect(st.eventsSnapshot).not.toBeNull(); // 快照仍命中
  });

  it('跨实例追加 + 对方 meta 写失败 → diskTail 探测 stale，无丢事件（P1-A）', async () => {
    const { storage, dir } = makeStorage('s4');
    writeEvents(dir, 's4', [
      ev(1, 'user/message', { content: 'a', messageId: 'm1' }),
    ]);
    await storage.read(); // 建快照 tail=1
    const st = expose(storage);
    expect(st.eventsSnapshot?.length).toBe(1);

    // 实例 B 追加 seq=2 到文件，但 B 的 meta 写失败（meta 不更新）
    appendFileSync(
      eventsPath(dir, 's4'),
      lineOf(ev(2, 'assistant/text', { content: 'b', messageId: 'm2' })),
      'utf-8'
    );

    const all = await storage.read();
    expect(all.length).toBe(2); // 无丢事件：diskTail(2) > memoryTailSeq(1) → stale → 磁盘路径
    expect(st.eventsSnapshot).toBeNull(); // 快照已失效
    expect(st.snapshotCooldownUntil).toBeGreaterThan(0); // 已置冷却（P0-3）
  });

  it('跨实例追加（meta 正常）→ stale + 冷却内不重建（P0-3）', async () => {
    const { storage, dir } = makeStorage('s5');
    writeEvents(dir, 's5', [
      ev(1, 'user/message', { content: 'a', messageId: 'm1' }),
    ]);
    await storage.read();
    const st = expose(storage);

    appendFileSync(
      eventsPath(dir, 's5'),
      lineOf(ev(2, 'assistant/text', { content: 'b', messageId: 'm2' })),
      'utf-8'
    );
    writeFileSync(metaPath(dir, 's5'), '2', 'utf-8');

    const all = await storage.read();
    expect(all.length).toBe(2);
    expect(st.eventsSnapshot).toBeNull();
    expect(st.snapshotCooldownUntil).toBeGreaterThan(0);

    // 冷却内再次 read：不重建快照，走磁盘路径
    const again = await storage.read();
    expect(again.length).toBe(2);
    expect(st.eventsSnapshot).toBeNull(); // 未重建
  });

  it('trimEvents 后失效并重建', async () => {
    const { storage, dir } = makeStorage('s6');
    writeEvents(dir, 's6', [
      ev(1, 'user/message', { content: 'a', messageId: 'm1' }),
      ev(2, 'assistant/text', { content: 'b', messageId: 'm2' }),
      ev(3, 'user/message', { content: 'c', messageId: 'm3' }),
    ]);
    await storage.read();
    const st = expose(storage);
    expect(st.eventsSnapshot?.length).toBe(3);

    await storage.trimEvents(3); // 保留 seq>=3
    expect(st.eventsSnapshot).toBeNull();
    expect(st.snapshotIneligible).toBe(false);

    const all = await storage.read();
    expect(all.map((e) => e.seq)).toEqual([3]);
    expect(st.eventsSnapshot).not.toBeNull(); // 重建
  });

  it('超限（条数）→ 永久 ineligible，走磁盘路径（P1-B）', async () => {
    const { storage, dir } = makeStorage('s7', { maxEvents: 2 });
    writeEvents(dir, 's7', [
      ev(1, 'user/message', { content: 'a', messageId: 'm1' }),
      ev(2, 'assistant/text', { content: 'b', messageId: 'm2' }),
      ev(3, 'user/message', { content: 'c', messageId: 'm3' }),
    ]);
    const st = expose(storage);
    const all = await storage.read();
    expect(all.length).toBe(3); // 磁盘路径返回全量
    expect(st.snapshotIneligible).toBe(true); // 永久禁用
    expect(st.eventsSnapshot).toBeNull();
  });

  it('append 增量超限 → 置 ineligible 并清空快照（P1-B）', async () => {
    const { storage, dir } = makeStorage('s8', { maxEvents: 2 });
    writeEvents(dir, 's8', [
      ev(1, 'user/message', { content: 'a', messageId: 'm1' }),
      ev(2, 'assistant/text', { content: 'b', messageId: 'm2' }),
    ]);
    await storage.read(); // 建快照 len=2（=maxEvents，未超）
    const st = expose(storage);
    expect(st.eventsSnapshot?.length).toBe(2);

    await storage.append(
      ev(3, 'user/message', { content: 'c', messageId: 'm3' })
    );
    // 增量 push 后 len=3 > 2 → ineligible + 清空（P1-B）
    expect(st.eventsSnapshot).toBeNull();
    expect(st.snapshotIneligible).toBe(true);
  });

  it('IO 失败 → 冷却重试，不永久禁用（P1-5）', async () => {
    const { storage, dir } = makeStorage('s9', {
      hook: async () => {
        throw new Error('simulated IO failure');
      },
    });
    writeEvents(dir, 's9', [
      ev(1, 'user/message', { content: 'a', messageId: 'm1' }),
    ]);
    const st = expose(storage);
    const all = await storage.read();
    expect(all.length).toBe(1); // 磁盘路径兜底
    expect(st.snapshotIneligible).toBe(false); // 不永久禁用（P1-5）
    expect(st.snapshotCooldownUntil).toBeGreaterThan(0); // 置冷却
    expect(st.eventsSnapshot).toBeNull();
  });

  it('损坏行恢复进快照 + excludeTypes 两路径一致（P0-4）', async () => {
    const { storage, dir } = makeStorage('s10');
    // 拼接损坏行：text + thinking 挤在一行（跨实例并发拼接场景）；
    // 后跟一条完整 user/message，避免 torn-tail 修复截断损坏行
    const corrupted =
      lineOf(
        ev(1, 'assistant/text', { content: 'xx', messageId: 'm1' })
      ).trimEnd() +
      lineOf(
        ev(2, 'assistant/thinking', { content: 'tt', messageId: 'm1' })
      ).trimEnd();
    writeRaw(
      dir,
      's10',
      corrupted +
        '\n' +
        lineOf(ev(3, 'user/message', { content: 'c', messageId: 'm3' }))
    );
    const st = expose(storage);

    // 快照路径：损坏行拆分恢复（thinking + text 均进快照）
    const all = await storage.read();
    expect(all.length).toBe(3);
    expect(st.eventsSnapshot?.length).toBe(3);

    // 快照路径 excludeTypes：恢复出的 thinking 被排除
    const snapExcl = await storage.read({
      excludeTypes: ['assistant/thinking'],
    });
    expect(snapExcl.map((e) => e.type)).toEqual([
      'assistant/text',
      'user/message',
    ]);

    // 磁盘路径（强制不可建快照）：与快照路径语义一致（P0-4 修复）
    st.eventsSnapshot = null;
    st.snapshotIneligible = true;
    st.snapshotCooldownUntil = 0;
    const diskExcl = await storage.read({
      excludeTypes: ['assistant/thinking'],
    });
    expect(diskExcl.map((e) => e.type)).toEqual([
      'assistant/text',
      'user/message',
    ]);
  });

  it('buildSnapshot 扫描期间 append 竞态 → 本次作废 + 冷却 + tailSeq 不回退（P1-A/P0-1/P2-E）', async () => {
    const { storage, dir } = makeStorage('s11', {
      hook: async () => {
        // 模拟扫描期间 append：内存 tailSeq 已推进（快照将缺该增量）
        const st = expose(storage);
        st.tailSeq = 2;
        st.tailSeqInitialized = true;
      },
    });
    writeEvents(dir, 's11', [
      ev(1, 'user/message', { content: 'a', messageId: 'm1' }),
    ]);
    const st = expose(storage);
    const all = await storage.read();
    expect(all.map((e) => e.seq)).toEqual([1]); // 磁盘路径返回扫描到的
    expect(st.eventsSnapshot).toBeNull(); // 快照作废未替换（P1-A）
    expect(st.snapshotCooldownUntil).toBeGreaterThan(0);
    expect(st.tailSeq).toBe(2); // tailSeq 不回退（P0-1）
  });
});
