/**
 * 债一残余线性路径收口（T3-10，2026-10-13）：`readBySeq()` / `getTailSeq()` 复用既有
 * `events.idx`（O(log N) 二分定位）与 `resolveScanStartOffset()`，不再自文件头**全扫**。
 *
 * 判据（可观测探针）：拦截 `EventLogStorage` 的**偏移读**入口 `openOffsetReadline(file, start)`，
 * 断言两条路径对 `events.jsonl` 的**起始偏移非 0**（= 走了 idx 定位而非从 offset 0 全扫），
 * 并在 **idx 缺失**时正确回退 offset 0（语义不变 + 只慢不错）。同时断言返回值与既有语义等价。
 *
 * 边界一致性（对齐既有契约）：不存在文件 / 空文件 / 越界 seq 的返回值保持原样。
 */
import { describe, expect, it, afterEach } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventLogStorage } from '../../src/session/storage/EventLogStorage';
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

/** 私有偏移读入口（本用例的可观测探针机位） */
interface TestableOffsetScan {
  openOffsetReadline: (file: string, start: number) => unknown;
}

const sessionDir = (dir: string, id: string): string => join(dir, HASH, id);
const eventsPath = (dir: string, id: string): string =>
  join(sessionDir(dir, id), 'events.jsonl');

function makeStorage(sessionId: string): {
  storage: EventLogStorage;
  dir: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'evtlog-idx-'));
  createdDirs.push(dir);
  // TB-14/E1-a：事件日志不自建会话目录，夹具预建（与生产时序一致）
  mkdirSync(sessionDir(dir, sessionId), { recursive: true });
  return { storage: new EventLogStorage(sessionId, HASH, dir), dir };
}

function ev(seq: number, content: string): LiriEvent {
  return {
    type: 'user/message' as never,
    schemaVersion: 1,
    seq,
    time: 1_700_000_000_000 + seq,
    sessionId: 's1',
    data: { content, messageId: `m${seq}` } as never,
  };
}

async function appendN(s: EventLogStorage, n: number): Promise<void> {
  for (let i = 1; i <= n; i++) await s.append(ev(0, `第${i}条`));
}

/** events.jsonl 每行的 UTF-8 起始偏移（第 k 个事件行 = offsets[k-1]） */
function lineOffsets(dir: string, id: string): number[] {
  const offsets: number[] = [];
  let off = 0;
  for (const line of readFileSync(eventsPath(dir, id), 'utf-8').split('\n')) {
    offsets.push(off);
    off += Buffer.byteLength(line, 'utf-8') + 1;
  }
  return offsets;
}

/** `events.idx` 末区间条目（派生物，与 append 折叠同构） */
function lastIdxEntry(
  dir: string,
  id: string
): { fromSeq: number; toSeq: number; byteOffset: number } {
  const lines = readFileSync(join(sessionDir(dir, id), 'events.idx'), 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  return JSON.parse(lines[lines.length - 1]) as never;
}

/**
 * 记录对 `events.jsonl` 的**起始偏移**（仅拦截目标文件；`.idx` 自身读取不计入），
 * 经 `openOffsetReadline` 探针机位捕获 —— `readBySeq` 走 `createReadlineInterface` → 委托至此亦被捕获。
 */
function spyEventScanStarts(storage: EventLogStorage): number[] {
  const starts: number[] = [];
  const st = storage as unknown as TestableOffsetScan;
  const orig = st.openOffsetReadline;
  st.openOffsetReadline = (file: string, start: number) => {
    if (file.endsWith('events.jsonl')) starts.push(start);
    return orig.call(storage, file, start);
  };
  return starts;
}

describe('T3-10 债一残余：readBySeq/getTailSeq 复用 idx 定位（非全扫）', () => {
  it('readBySeq 复用 idx：seek 到覆盖该 seq 的区间首行偏移（非 0 全扫），结果等价', async () => {
    const sid = 't310-readbyseq';
    const N = 600;
    const { storage, dir } = makeStorage(sid);
    await appendN(storage, N);
    const last = lastIdxEntry(dir, sid); // 末区间 [257..512]
    const offsets = lineOffsets(dir, sid);

    const restored = new EventLogStorage(sid, HASH, dir);
    await restored.getTailSeq(); // 预热：加载 idx（避免将预热扫描计入探针）
    const starts = spyEventScanStarts(restored);

    const hit = await restored.readBySeq(300);
    expect(hit?.seq).toBe(300);
    expect((hit?.data as { content: string }).content).toBe('第300条');
    // 覆盖 seq=300 的区间 = 末区间（[257..512]）⇒ seek 起点 = 该区间首行偏移（>0）
    expect(last.fromSeq).toBeLessThanOrEqual(300);
    expect(last.toSeq).toBeGreaterThanOrEqual(300);
    expect(starts).toEqual([offsets[last.fromSeq - 1]]);
    expect(starts[0]).toBeGreaterThan(0);

    // 与全量 read 的语义等价（同一事件）
    const viaRead = await restored.read({ fromSeq: 300, toSeq: 300, limit: 1 });
    expect(viaRead.map((e) => e.seq)).toEqual([300]);
    expect((viaRead[0].data as { content: string }).content).toBe('第300条');
  }, 20000);

  it('readBySeq 未索引尾部：目标在末折叠批之后 ⇒ 从末区间起点续扫（非 0 全扫）', async () => {
    const sid = 't310-readbyseq-tail';
    const N = 600; // 末折叠批 = [257..512]；513..600 为未折叠尾部
    const { storage, dir } = makeStorage(sid);
    await appendN(storage, N);
    const last = lastIdxEntry(dir, sid);
    const offsets = lineOffsets(dir, sid);
    expect(last.toSeq).toBeLessThan(N); // 前提：目标确在 idx 覆盖之外

    const restored = new EventLogStorage(sid, HASH, dir);
    await restored.getTailSeq(); // 预热
    const starts = spyEventScanStarts(restored);

    const hit = await restored.readBySeq(N);
    expect(hit?.seq).toBe(N);
    expect((hit?.data as { content: string }).content).toBe(`第${N}条`);
    // 未索引尾部 ⇒ 从末区间起点续扫（>0），而非自文件头全扫
    expect(starts).toEqual([offsets[last.fromSeq - 1]]);
    expect(starts[0]).toBeGreaterThan(0);
  }, 20000);

  it('readBySeq 回退：idx 缺失 ⇒ 从 offset 0 全扫（只慢不错），结果仍正确', async () => {
    const sid = 't310-readbyseq-noidx';
    const N = 300;
    const { storage, dir } = makeStorage(sid);
    await appendN(storage, N);
    rmSync(join(sessionDir(dir, sid), 'events.idx'), { force: true });

    const restored = new EventLogStorage(sid, HASH, dir);
    await restored.getTailSeq(); // 预热（idx 缺失 ⇒ 已回退到 0）
    const starts = spyEventScanStarts(restored);

    const hit = await restored.readBySeq(200);
    expect(hit?.seq).toBe(200);
    expect(starts).toEqual([0]); // 无 idx 可定位 ⇒ 回退文件头
  }, 20000);

  it('getTailSeq 复用 idx：从末区间起点续扫（非 0 全扫），结果 = 真实尾 seq', async () => {
    const sid = 't310-tail';
    const N = 600;
    const { storage, dir } = makeStorage(sid);
    await appendN(storage, N);
    const last = lastIdxEntry(dir, sid);
    const offsets = lineOffsets(dir, sid);

    const restored = new EventLogStorage(sid, HASH, dir);
    const starts = spyEventScanStarts(restored);

    const tail = await restored.getTailSeq(true); // force ⇒ 走读盘扫描路径
    expect(tail).toBe(N);
    // 最大 seq 必落在末区间内 ⇒ 从末区间首行偏移续扫（>0），而非自文件头
    expect(starts).toEqual([offsets[last.fromSeq - 1]]);
    expect(starts[0]).toBeGreaterThan(0);
  }, 20000);

  it('getTailSeq 回退：idx 缺失 ⇒ 从 offset 0 全扫，结果仍为真实尾 seq', async () => {
    const sid = 't310-tail-noidx';
    const N = 400;
    const { storage, dir } = makeStorage(sid);
    await appendN(storage, N);
    rmSync(join(sessionDir(dir, sid), 'events.idx'), { force: true });

    const restored = new EventLogStorage(sid, HASH, dir);
    const starts = spyEventScanStarts(restored);
    const tail = await restored.getTailSeq(true);
    expect(tail).toBe(N);
    expect(starts).toEqual([0]);
  }, 20000);

  it('边界：不存在文件 / 空文件 / 越界 seq 的返回值保持既有语义', async () => {
    // 不存在
    const { storage: s1 } = makeStorage('t310-none');
    expect(await s1.readBySeq(1)).toBeNull();
    expect(await s1.getTailSeq(true)).toBe(0);

    // 空文件（0 字节）
    const sid = 't310-empty';
    const { dir } = makeStorage(sid);
    writeFileSync(eventsPath(dir, sid), '', 'utf-8');
    const s2 = new EventLogStorage(sid, HASH, dir);
    expect(await s2.readBySeq(1)).toBeNull();
    expect(await s2.getTailSeq(true)).toBe(0);

    // 越界 seq（文件存在但无该 seq）
    const sid3 = 't310-oob';
    const { storage: s3, dir: dir3 } = makeStorage(sid3);
    await appendN(s3, 50);
    const s3b = new EventLogStorage(sid3, HASH, dir3);
    expect(await s3b.readBySeq(9999)).toBeNull();
  }, 20000);
});
