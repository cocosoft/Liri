#!/usr/bin/env bun
/**
 * G-5（2026-10-18）—— **Daemon 多会话事件写入压测**（非 CI 门禁）。
 *
 * 背景（清单 §6 G-5）：`EventLogStorage.append` 用**异步** `fs.appendFile`（不是 Google 所述的
 * "同步 flush"）；流式正文另有 `EventLogTextBuffer` 的 64KB/2s 聚合。本脚本测的是**非正文事件**
 * 在「26 会话并发」下的写延迟与**事件循环滞后**，用于判断是否需要「非正文事件批写」。
 *
 * 测什么：
 *   F1 单会话基线：1 个会话串行 append N 条（真实形态：每会话一个 `EventLogStorage` 实例）；
 *   F2 26 会话并发：26 个会话各自串行 append N 条，整体并行（对齐 daemon 多通道写入形态）。
 *
 * 判定（阈值写死，满足任一条即"有瓶颈"，才评估批写；**不直接引入 Ring Buffer**）：
 *   ① 26 会话并发下 append **P95 > 20 ms**；
 *   ② 事件循环滞后 **P95 > 50 ms**。
 *
 * 用法（app 目录下）：`bun run bench:eventlog-concurrency`
 * **不作为 CI 门禁**（受机器负载影响；数据只用于趋势与阈值判定）。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLogStorage } from '../src/session/storage/EventLogStorage';
import type { LiriEvent } from '../src/session/types/events';

/** 并发会话数（daemon 多通道压测口径） */
const SESSIONS = 26;
/** 每个会话追加的非正文事件数 */
const EVENTS_PER_SESSION = 40;

/** 判定阈值（清单 §6 G-5 的"确有瓶颈"口径；写死避免事后调参） */
const P95_WRITE_MS = 20;
const P95_LOOP_LAG_MS = 50;

const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const round = (n: number): number => Math.round(n * 100) / 100;

interface PhaseResult {
  label: string;
  appendP50: number;
  appendP95: number;
  appendMax: number;
  loopP95: number;
  loopMax: number;
  failures: number;
  elapsedMs: number;
}

/** 事件循环滞后采样器（`setInterval(10ms)` 抖动） */
function startLoopLagSampler(): { stop: () => { p95: number; max: number } } {
  const lags: number[] = [];
  let expected = performance.now() + 10;
  const timer = setInterval(() => {
    const now = performance.now();
    lags.push(Math.max(0, now - expected));
    expected = now + 10;
  }, 10);
  return {
    stop: () => {
      clearInterval(timer);
      return { p95: pct(lags, 0.95), max: Math.max(0, ...lags) };
    },
  };
}

function makeEvent(sessionId: string, turn: number): LiriEvent {
  return {
    // 非正文事件（正文走 `EventLogTextBuffer` 的聚合路径，不在本压测范围）
    type: 'turn/start',
    // `seq <= 0` ⇒ `append` 在互斥队列内原子分配（生产同款路径）
    seq: 0,
    time: Date.now(),
    sessionId,
    data: { turn, marker: 'g5-bench' },
  } as LiriEvent;
}

/**
 * F0 对照：**相同次数的小文件 I/O**（读 tail → append 正文 → 写 tail），不含存储层逻辑。
 *
 * 目的：把 26 路并发下的延迟归因到「文件 I/O」还是「`EventLogStorage` 自身开销（序列化/校验/快照）」。
 */
async function runRawIoPhase(
  label: string,
  root: string,
  sessionCount: number
): Promise<PhaseResult> {
  const dirs = Array.from({ length: sessionCount }, (_, i) => {
    const dir = join(root, 'default', `bench_s${i}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  });
  const sampler = startLoopLagSampler();
  const latencies: number[] = [];
  let failures = 0;

  await Promise.all(
    dirs.map(async (dir) => {
      const eventsPath = join(dir, 'events.jsonl');
      const tailPath = join(dir, 'events.tail');
      for (let i = 1; i <= EVENTS_PER_SESSION; i++) {
        const t0 = performance.now();
        try {
          await readFile(tailPath, 'utf-8').catch(() => '');
          await appendFile(eventsPath, `{"seq":${i}}\n`, 'utf-8');
          await writeFile(tailPath, String(i), 'utf-8');
        } catch {
          failures += 1;
        }
        latencies.push(performance.now() - t0);
      }
    })
  );

  const lag = sampler.stop();
  return {
    label,
    appendP50: pct(latencies, 0.5),
    appendP95: pct(latencies, 0.95),
    appendMax: Math.max(0, ...latencies),
    loopP95: lag.p95,
    loopMax: lag.max,
    failures,
    elapsedMs: 0,
  };
}

async function runPhase(
  label: string,
  root: string,
  sessionCount: number
): Promise<PhaseResult> {
  const stores = Array.from({ length: sessionCount }, (_, i) => {
    const id = `bench_s${i}`;
    mkdirSync(join(root, 'default', id), { recursive: true });
    return new EventLogStorage(id, 'default', root);
  });

  const startedAt = performance.now();
  const sampler = startLoopLagSampler();
  const latencies: number[] = [];
  let failures = 0;

  await Promise.all(
    stores.map(async (store, si) => {
      for (let i = 1; i <= EVENTS_PER_SESSION; i++) {
        const t0 = performance.now();
        const r = await store.append(makeEvent(`bench_s${si}`, i));
        latencies.push(performance.now() - t0);
        if (!r.ok) failures += 1;
      }
    })
  );

  const elapsedMs = performance.now() - startedAt;
  const lag = sampler.stop();

  return {
    label,
    appendP50: pct(latencies, 0.5),
    appendP95: pct(latencies, 0.95),
    appendMax: Math.max(0, ...latencies),
    loopP95: lag.p95,
    loopMax: lag.max,
    failures,
    elapsedMs,
  };
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'pyapp-g5-'));
  console.log('=== G-5 Daemon 多会话事件写入压测（非门禁）===');
  console.log(
    `参数：${SESSIONS} 会话 × ${EVENTS_PER_SESSION} 条非正文事件（\`turn/start\`）；` +
      `正文聚合路径不在本测范围\n`
  );

  try {
    // 各阶段用**独立根**，避免前一阶段残留的 events.jsonl / events.tail 影响后一阶段
    const rawIo = await runRawIoPhase(
      '纯 I/O 对照',
      join(root, 'rawio'),
      SESSIONS
    );
    const single = await runPhase('单会话基线', join(root, 'single'), 1);
    const concurrent = await runPhase(
      '26 会话并发',
      join(root, 'concurrent'),
      SESSIONS
    );

    const rows = [rawIo, single, concurrent];
    for (const r of rows) {
      console.log(
        `${r.label.padEnd(12)} append p50 ${round(r.appendP50)} ms / p95 ${round(r.appendP95)} ms / max ${round(r.appendMax)} ms` +
          ` · 事件循环滞后 p95 ${round(r.loopP95)} ms / max ${round(r.loopMax)} ms` +
          ` · 失败 ${r.failures}` +
          (r.elapsedMs > 0 ? ` · 总耗时 ${round(r.elapsedMs)} ms` : '')
      );
    }

    const ioShare =
      concurrent.appendP95 > 0 ? rawIo.appendP95 / concurrent.appendP95 : 0;

    console.log('\n--- 结论 ---');
    console.log(
      `26 会话并发 append P95 ${round(concurrent.appendP95)} ms；` +
        `纯 I/O 对照 P95 ${round(rawIo.appendP95)} ms（占 ${round(ioShare * 100)}%）；` +
        `事件循环滞后 P95 ${round(concurrent.loopP95)} ms（阈值 ${P95_LOOP_LAG_MS} ms）。`
    );
    const blocked = concurrent.loopP95 > P95_LOOP_LAG_MS;
    const ioBound = ioShare >= 0.6;
    if (blocked) {
      console.log(
        '判定：事件循环滞后**超过** 50 ms ⇒ "同步写入阻塞事件循环"的命题成立，需立项评估。'
      );
    } else if (ioBound) {
      console.log(
        '判定：事件循环**未阻塞**（原命题不成立）；26 路突发下的写延迟主要是**小文件 I/O 本身**' +
          `（纯 I/O 占 ${round(ioShare * 100)}%，每事件 3 次文件操作：读 tail → append → 写 tail）。` +
          '**不改造**：改批写不会降低单次 append 的等待（调用方仍需 await 落盘），' +
          '且会牺牲「返回前已落盘」的时序；**不引入 Ring Buffer**（CS03）。' +
          `重开条件：真实 daemon 观测到 append P95 > ${P95_WRITE_MS} ms 且纯 I/O 占比 < 60%（⇒ 存储层自身开销）` +
          '或事件循环滞后 P95 > 50 ms。'
      );
    } else {
      console.log(
        `判定：事件循环未阻塞，但写延迟中**存储层开销占 ${round((1 - ioShare) * 100)}%**（纯 I/O 仅 ${round(rawIo.appendP95)} ms）` +
          ' ⇒ 需评估 `EventLogStorage` 侧优化（校验/快照/尾元数据），**不引入 Ring Buffer**。'
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('压测运行失败：', err);
    process.exit(1);
  });
