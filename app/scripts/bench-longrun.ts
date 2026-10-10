#!/usr/bin/env bun
/**
 * R9 —— **长期运行与恢复基准**（第九轮审查 §5.1）
 *
 * 回答两个问题：
 *   ① 长会话/长事件日志的加载**分布**（P50/P95）与**峰值内存**是多少？
 *   ② 数据量 ×10 时，耗时/内存是 **≈×10（线性）** 还是 **×10+（超线性，需排查）**？
 *
 * 落点选择（CS01 归一化）：与既有 `scripts/measure-session-memory.ts`（真实会话隔离内存）、
 * `scripts/probe-memory-handles.ts`（句柄泄漏）**同源同径** —— 均直接驱动真实
 * `EventLogStorage`；本脚本补的是**合成可缩放夹具 + P50/P95 + 趋势比**（既有脚本用真实会话、
 * 不缩放，无法回答"×10 是否 ×10+"）。
 *
 * 覆盖：F1 长事件日志恢复（长会话加载）· **F1b 索引缺失回退路径（L-9 残余/P0-5）** ·
 * F2 多会话并发（锁等待）· F3 长跑内存趋势（泄漏）。
 * **未覆盖（如实）**：大知识库检索（需先播种索引，另建脚本）· FD/进程数长跑（见
 * `scripts/probe-memory-handles.ts`，本脚本只报堆趋势）。
 *
 * 用法（app 目录下）：`bun run scripts/bench-longrun.ts`
 * **不作为 CI 门禁**（基准受机器负载影响）——产物用于**趋势观察 + 异常登记**。
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLogStorage } from '../src/session/storage/EventLogStorage';

const BASE_EVENTS = 5_000;
const SCALES = [1, 10];
const REPS = 12;
const CONCURRENT_SESSIONS = 6;
const MB = 1048576;

const mb = (b: number): string => (b / MB).toFixed(1);
const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

/**
 * 写入合成事件日志。
 * 必须满足真实读取端契约（否则全行被 `isLiriEvent`/`assertEventReadable` 跳过 ⇒ 基准失真）：
 *   - 结构：`{ type, seq, time, sessionId, data:object }`（`isLiriEvent` 逐字段校验）；
 *   - 类型：须在 `KNOWN_SESSION_EVENT_TYPES` 内（此处用真实类型 `user/message` / `assistant/text`）。
 *
 * **L-9（2026-10-09）夹具保真修正**：生产 append 路径每 `IDX_BATCH_SIZE`(=256) 条事件折叠一条
 * `events.idx`（`EventLogStorage` P3-8）；旧版夹具**直接写 `events.jsonl` 绕过 append ⇒ 无 idx**
 * ⇒ 分页续读落到"索引缺失回退路径"（每页从 offset 0 regex-skip 重扫，累计 ≈O(N²/PAGE)），
 * 测出的是**回退路径**而非生产路径。此处按 append 同款语义补写 `events.idx`（UTF-8 字节偏移 +
 * 每 256 条一个区间；尾部不足一批不折叠，与 append 一致），使 F1 反映**生产恢复路径**。
 *
 * `withIdx=false` 用于 **F1b**：显式构造"idx 缺失/落后"的回退路径夹具，验证 P0-5 续页锚点
 * （L-9 残余）在该路径下亦近似线性。
 */
function seedSession(
  root: string,
  id: string,
  n: number,
  withIdx = true
): void {
  const dir = join(root, 'default', id);
  mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  for (let i = 1; i <= n; i++) {
    lines.push(
      JSON.stringify({
        type: i % 3 === 0 ? 'assistant/text' : 'user/message',
        seq: i,
        time: 1_700_000_000_000 + i,
        sessionId: id,
        data: { text: 'x'.repeat(200), index: i },
      })
    );
  }
  writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n', 'utf-8');

  // events.idx：与 append 路径同构 —— 每 256 条折叠 {fromSeq,toSeq,byteOffset,count}
  // byteOffset = 该批首行在文件中的 UTF-8 字节起始偏移（行含末尾 '\n'）
  const IDX_BATCH = 256;
  const idxLines: string[] = [];
  let offset = 0;
  let batchStart = 0;
  let batchStartSeq = 1;
  for (let i = 0; i < lines.length; i++) {
    if (i % IDX_BATCH === 0) {
      batchStart = offset;
      batchStartSeq = i + 1;
    }
    offset += Buffer.byteLength(lines[i] + '\n', 'utf-8');
    if ((i + 1) % IDX_BATCH === 0) {
      idxLines.push(
        JSON.stringify({
          fromSeq: batchStartSeq,
          toSeq: i + 1,
          byteOffset: batchStart,
          count: IDX_BATCH,
        })
      );
    }
  }
  if (withIdx && idxLines.length > 0) {
    writeFileSync(join(dir, 'events.idx'), idxLines.join('\n') + '\n', 'utf-8');
  }
}

const PAGE = 10_000;

/**
 * 分页读全量事件行数。
 * `EventLogStorage.read` 的 `limit` **上限硬编码 10000**（`Math.min(query.limit, 10000)`）——
 * 直接传 `MAX_SAFE_INTEGER` 会被静默截断为首页，令"×10 规模"只读到同一批行、伪造出线性假象。
 * 故必须按 `seq` 续读至尾。
 */
async function readAllRows(
  root: string,
  id: string,
  page = PAGE,
  snapshotHotWindow?: number
): Promise<number> {
  const s = new EventLogStorage(id, 'default', root, snapshotHotWindow);
  let fromSeq = 1;
  let total = 0;
  for (;;) {
    const got = await s.read({ fromSeq, limit: page });
    total += got.length;
    if (got.length < page) break;
    fromSeq = got[got.length - 1].seq + 1;
  }
  return total;
}

interface LoadStat {
  p50: number;
  p95: number;
  max: number;
  peakHeapDelta: number;
  rows: number;
  bytes: number;
}

async function measureLoad(
  root: string,
  id: string,
  reps: number,
  page = PAGE,
  snapshotHotWindow?: number
): Promise<LoadStat> {
  const heap0 = process.memoryUsage().heapUsed;
  let peak = heap0;
  const times: number[] = [];
  let rows = 0;
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    rows = await readAllRows(root, id, page, snapshotHotWindow);
    times.push(performance.now() - t0);
    peak = Math.max(peak, process.memoryUsage().heapUsed);
  }
  const bytes = statSync(join(root, 'default', id, 'events.jsonl')).size;
  return {
    p50: pct(times, 0.5),
    p95: pct(times, 0.95),
    max: Math.max(...times),
    peakHeapDelta: peak - heap0,
    rows,
    bytes,
  };
}

const round = (n: number): number => Math.round(n * 10) / 10;

/**
 * 单条加载基准：按 `SCALES` 播种并测 P50/P95/max/峰值堆，最后打印"数据 ×10 ⇒ ?"趋势比。
 * `withIdx=false`（F1b）走**索引缺失回退路径** —— 用于验证 P0-5 续页锚点收口 L-9 残余。
 */
async function benchLoad(
  root: string,
  label: string,
  prefix: string,
  withIdx: boolean,
  page = PAGE,
  snapshotHotWindow?: number
): Promise<void> {
  console.log(`\n--- ${label} ---`);
  console.log(
    '规模     事件数   文件       P50(ms)  P95(ms)  max(ms)  峰值堆增量'
  );
  const stats: LoadStat[] = [];
  for (const scale of SCALES) {
    const id = `${prefix}-${scale}x`;
    seedSession(root, id, BASE_EVENTS * scale, withIdx);
    const st = await measureLoad(root, id, REPS, page, snapshotHotWindow);
    stats.push(st);
    console.log(
      `${String(scale).padEnd(8)}${String(st.rows).padEnd(9)}${(st.bytes / 1024)
        .toFixed(0)
        .padEnd(10)}${round(st.p50).toString().padEnd(9)}${round(st.p95)
        .toString()
        .padEnd(9)}${round(st.max).toString().padEnd(9)}${mb(
        st.peakHeapDelta
      )}MB`
    );
  }
  const timeRatio = stats[0].p50 > 0 ? stats[1].p50 / stats[0].p50 : 0;
  const memRatio =
    stats[0].peakHeapDelta > 0
      ? stats[1].peakHeapDelta / stats[0].peakHeapDelta
      : 0;
  console.log(
    `趋势：数据 ×10 ⇒ P50 ×${round(timeRatio)}、峰值堆 ×${round(memRatio)}` +
      (timeRatio > 12 || memRatio > 12
        ? '  ⚠️ 超线性（需排查）'
        : '  ✅ 近似线性')
  );
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'bench-longrun-'));
  console.log('=== R9 长期运行与恢复基准（合成夹具，非 CI 门禁）===');
  console.log(`夹具根: ${root}`);

  try {
    // ── F1 长事件日志恢复（长会话加载）：分布 + 峰值内存 + 趋势比 ──
    await benchLoad(
      root,
      'F1 长事件日志恢复（长会话加载，含 events.idx = 生产恢复路径）',
      'f1',
      true
    );
    // F1b：**回退路径对照** —— 无 idx（idx 缺失/落后）时的续页线性续扫（P0-5 收口 L-9 残余）。
    // 为使该路径**真的被走到**：① 页大小压到 1000（×10 规模 = 50 个续页，放大 O(N²/PAGE) 效应，
    // 改动前每页从 offset 0 重扫 ⇒ 总扫描量 ≈25×N）；② 快照热窗口压到 100（默认 min(150000,10000)
    // 会把 5000 条整体缓存 ⇒ 小规模根本不落盘、基准失真）。改动后两规模均近似 ×10。
    await benchLoad(
      root,
      'F1b 长事件日志恢复（无 events.idx = 索引缺失回退路径，验证 P0-5 续页锚点）',
      'f1b',
      false,
      1_000,
      100
    );

    // ── F2 多会话并发（锁等待）：串行 vs 并发 ──
    console.log('\n--- F2 多会话并发（锁等待）---');
    const bigN = BASE_EVENTS * SCALES[SCALES.length - 1];
    const ids = Array.from(
      { length: CONCURRENT_SESSIONS },
      (_, i) => `f2-${i}`
    );
    for (const id of ids) seedSession(root, id, bigN);
    const load = (id: string): Promise<number> => readAllRows(root, id);

    const tSeq0 = performance.now();
    for (const id of ids) await load(id);
    const seqTotal = performance.now() - tSeq0;
    const tCon0 = performance.now();
    const results = await Promise.all(ids.map((id) => load(id)));
    const conTotal = performance.now() - tCon0;
    console.log(
      `${CONCURRENT_SESSIONS} 个会话 × ${bigN} 事件：串行 ${round(seqTotal)}ms · ` +
        `并发 ${round(conTotal)}ms（加速比 ×${round(seqTotal / conTotal)}，全部返回 ${Math.max(
          ...results
        )} 行）`
    );

    // ── F3 长跑内存趋势（重复加载是否线性增长）──
    console.log('\n--- F3 长跑内存趋势（重复加载 30 次）---');
    const target = ids[0];
    const h0 = process.memoryUsage().heapUsed;
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const s = new EventLogStorage(target, 'default', root);
      await s.read({ limit: 2000, fromSeq: 1 });
      samples.push(process.memoryUsage().heapUsed);
    }
    const first5 = samples.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const last5 = samples.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const growth = (last5 - first5) / MB;
    console.log(
      `heapUsed 首 5 次均值 ${mb(first5)}MB → 末 5 次均值 ${mb(last5)}MB（净增 ${growth.toFixed(
        1
      )}MB）` + (growth > 50 ? '  ⚠️ 疑似泄漏（需排查）' : '  ✅ 无明显增长')
    );
    console.log(`基线 heapUsed ${mb(h0)}MB`);

    console.log(
      '\n未覆盖（如实）：大知识库检索（需先播种索引，另建脚本）· FD/进程数长跑（见 scripts/probe-memory-handles.ts）'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error('基准运行失败：', err);
  process.exit(1);
});
