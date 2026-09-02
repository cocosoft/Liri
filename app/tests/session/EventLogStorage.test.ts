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
  snapshotMinSeq: number;
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

  it('超限（条数）→ 滑动窗口保留最近，读盘路径补全全量（B0，替代 P1-B 永久 ineligible）', async () => {
    const { storage, dir } = makeStorage('s7', { maxEvents: 2 });
    writeEvents(dir, 's7', [
      ev(1, 'user/message', { content: 'a', messageId: 'm1' }),
      ev(2, 'assistant/text', { content: 'b', messageId: 'm2' }),
      ev(3, 'user/message', { content: 'c', messageId: 'm3' }),
    ]);
    const st = expose(storage);
    const all = await storage.read();
    expect(all.length).toBe(3); // 磁盘路径返回全量（窗口不覆盖 seq1）
    // B0：不再永久 ineligible + 整体清空——快照保留最近 2 条热窗口
    expect(st.snapshotIneligible).toBe(false);
    expect(st.eventsSnapshot?.map((e) => e.seq)).toEqual([2, 3]);
    expect(st.snapshotMinSeq).toBe(2);
    // 尾部读取命中窗口（fromSeq ≥ snapshotMinSeq）
    const tail = await storage.read({ fromSeq: 3 });
    expect(tail.map((e) => e.seq)).toEqual([3]);
  });

  it('append 增量超限 → 滑动窗口裁剪保留最近（B0，替代 P1-B 清空）', async () => {
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
    // 增量 push 后 len=3 > 2 → 滑动窗口裁剪为最近 2 条（seq 2,3），非清空
    expect(st.eventsSnapshot?.map((e) => e.seq)).toEqual([2, 3]);
    expect(st.snapshotMinSeq).toBe(2);
    expect(st.snapshotIneligible).toBe(false);
    expect(st.snapshotCooldownUntil).toBeGreaterThan(0); // 置冷却（B-3 防风暴）
    // 窗口可继续服务尾部读取
    const tail = await storage.read({ fromSeq: 2 });
    expect(tail.map((e) => e.seq)).toEqual([2, 3]);
    // 全量读取仍由磁盘路径补全（语义不变）
    const all = await storage.read();
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3]);
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

  // ─── P3-7a（2026-09-02）：append 原子分配 seq，根治并发 duplicate-seq ───
  describe('append 原子分配 seq（P3-7a）', () => {
    it('seq<=0 事件由 append 自动分配且递增', async () => {
      const { storage } = makeStorage('s-p37a');
      const r1 = await storage.append(
        ev(0, 'user/message', { content: 'a', messageId: 'm1' })
      );
      const r2 = await storage.append(
        ev(0, 'user/message', { content: 'b', messageId: 'm2' })
      );
      expect(r1.ok).toBe(true);
      expect(r1.tailSeq).toBe(1); // 自动分配 1
      expect(r2.tailSeq).toBe(2); // 自动分配 2（递增）
      const all = await storage.read();
      expect(all.map((e) => e.seq)).toEqual([1, 2]);
    });

    it('并发生产者 append(seq=0) 互不冲突（模拟实时流 vs 落盘竞争）', async () => {
      const { storage } = makeStorage('s-p37a-conc');
      // 模拟 4 个生产者并发 append（此前各自 getTailSeq+1 → 读到相同值 → duplicate-seq）
      const results = await Promise.all(
        Array.from({ length: 4 }, async (_, i) =>
          storage.append(
            ev(0, 'user/message', { content: `m${i}`, messageId: `id${i}` })
          )
        )
      );
      expect(results.every((r) => r.ok)).toBe(true);
      expect(results.some((r) => r.reason === 'duplicate-seq')).toBe(false);
      // 分配的 seq 全部唯一且连续
      const seqs = results.map((r) => r.tailSeq);
      expect(new Set(seqs).size).toBe(4);
      expect(Math.max(...seqs) - Math.min(...seqs)).toBe(3);
      // 磁盘 seq 连续无 GAP（4 个事件）
      const all = await storage.read();
      expect(all.map((e) => e.seq).sort((a, b) => a - b)).toEqual(
        seqs.sort((a, b) => a - b)
      );
    });
  });

  // ─── P3-8（2026-09-02）：事件字节索引（v4 方案 B-1/D7 索引独立先行）───
  describe('P3-8 事件字节索引', () => {
    it('写入 >256 事件（含中文）后分页续读与全量结果一致（G-4 UTF-8 seek 精确）', async () => {
      const { storage } = makeStorage('s-p38-seek');
      const N = 600;
      for (let i = 1; i <= N; i++) {
        await storage.append(
          ev(0, 'user/message', {
            content: `中文消息第${i}条`,
            messageId: `m${i}`,
          })
        );
      }
      const full = await storage.read({ limit: 10000 });
      expect(full.length).toBe(N);
      // 命中多个索引区间 + 批内行扫的 fromSeq（含区间边界/中文内容）
      for (const from of [1, 100, 257, 300, 550, 599, 600]) {
        const paged = await storage.read({
          fromSeq: from,
          toSeq: N,
          limit: 10000,
        });
        const expectSeq = full.filter((e) => e.seq >= from);
        expect(paged.length).toBe(expectSeq.length);
        expect(paged.map((e) => e.seq)).toEqual(expectSeq.map((e) => e.seq));
        // 内容精确一致（seek 偏移无偏斜；G-4 中文 UTF-8 验证）
        expect(paged.map((e) => (e.data as { content: string }).content)).toEqual(
          expectSeq.map((e) => (e.data as { content: string }).content)
        );
      }
    });

    it('.idx 持久化后新实例（重启）读同一目录命中索引', async () => {
      const { storage, dir } = makeStorage('s-p38-reload');
      for (let i = 1; i <= 300; i++) {
        await storage.append(
          ev(0, 'user/message', { content: `重启消息${i}`, messageId: `rm${i}` })
        );
      }
      // 重启：同目录新实例（内存索引丢失，依赖 .idx 文件恢复）
      const restored = new EventLogStorage('s-p38-reload', HASH, dir);
      const st = restored as unknown as { idxLoaded: boolean };
      expect(st.idxLoaded).toBe(false);
      const paged = await restored.read({ fromSeq: 200, toSeq: 250, limit: 100 });
      expect(paged.length).toBe(51);
      expect(paged[0].seq).toBe(200);
      expect((paged[0].data as { content: string }).content).toBe('重启消息200');
    });

    it('trim 后索引作废，重新 append 偏移正确（F-1）', async () => {
      const { storage } = makeStorage('s-p38-trim');
      for (let i = 1; i <= 300; i++) {
        await storage.append(
          ev(0, 'user/message', { content: `t${i}`, messageId: `t${i}` })
        );
      }
      await storage.trimEvents(200); // 保留 200-300
      const afterTrim = await storage.read({ fromSeq: 200, limit: 10000 });
      expect(afterTrim.length).toBe(101);
      // trim 后继续 append，偏移从头累计正确（seq 继续）
      await storage.append(
        ev(0, 'user/message', { content: 'trim后新消息', messageId: 'post-trim' })
      );
      const all = await storage.read({ limit: 10000 });
      const last = all[all.length - 1];
      expect(last.seq).toBe(301);
      expect((last.data as { content: string }).content).toBe('trim后新消息');
    });
  });

  // ─── A-2①（2026-09-02，v4 §5.2 选项①）：text 聚合缓冲下沉存储层 ───
  describe('A-2① text 缓冲（bufferTextChunk / flushTextBuffer）', () => {
    it('buffer + flush → 按 messageId 聚合为单条 assistant/text-batch（seq 原子分配）', async () => {
      const { storage } = makeStorage('a2-batch');
      await storage.bufferTextChunk('m1', '你好');
      await storage.bufferTextChunk('m1', '世界');
      const flushed = await storage.flushTextBuffer();
      expect(flushed).toBe(2);

      const all = await storage.read();
      const text = all.filter((e) => e.type === 'assistant/text-batch');
      expect(text.length).toBe(1);
      expect((text[0].data as { content: string }).content).toBe('你好世界');
      expect(text[0].seq).toBe(1);
    });

    it('read 前自动 flush：流进行中读路径可见已入缓冲正文（A-2 所有权闭环）', async () => {
      const { storage } = makeStorage('a2-read');
      // 只 buffer 不显式 flush → read 内部先 flush 再读
      await storage.bufferTextChunk('m2', '流中正文');
      const all = await storage.read();
      const text = all.filter((e) => e.type === 'assistant/text-batch');
      expect(text.length).toBe(1);
      expect((text[0].data as { content: string }).content).toBe('流中正文');
    });

    it('直接 append 前自动 flush：缓冲正文 seq 先于后续事件（顺序不破坏）', async () => {
      const { storage } = makeStorage('a2-order');
      await storage.append(
        ev(0, 'user/message', { content: 'u', messageId: 'u1' })
      ); // seq=1
      await storage.bufferTextChunk('m3', '正文内容');
      // 直接 append tool_call → append 内先 flush 缓冲正文（seq=2），tool 得 seq=3
      await storage.append(
        ev(0, 'assistant/tool_call', {
          toolCallId: 'tc-1',
          name: 'file_read',
          args: { path: '/a' },
          messageId: 'm3',
        })
      );
      const all = await storage.read();
      const text = all.find((e) => e.type === 'assistant/text-batch');
      const tool = all.find((e) => e.type === 'assistant/tool_call');
      expect(text?.seq).toBe(2);
      expect(tool?.seq).toBe(3);
      expect((text?.data as { content: string }).content).toBe('正文内容');
    });
  });
});
