/**
 * U-25 · liri-native 侧车化量化（2026-10-18）
 *
 * 目的：为「是否把 `app/native` 迁到独立进程（侧车）」提供**可复现**的延迟数据。
 * 口径（CS06）：只测本机能跑出来的数；原生不可用 ⇒ 明确报告并退出 0（不编造）。
 *
 * 度量：
 *   ① 原生**进程内直调** P50/P95（12 个调用点的底层函数代表）；
 *   ② 对应**纯 JS 回退** P50/P95（仅当存在等价回退：token 估算、文件读取）；
 *   ③ **IPC 往返代理**：fork 子进程 + 1KB 消息 echo 的 P50/P95
 *      —— 侧车化增量 ≈ ③ − ①（序列化 + 往返）；不测真实侧车实现，避免臆造。
 *
 * 运行：`bun run scripts/bench-native-sidecar.ts`（只写系统临时目录）
 */

import { fork } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// 统一 JS 估算入口（`roughTokenCountEstimation` 的替代路径，用于对照）
import { estimateMessagesTokens } from '@modules/ai';

const REPEAT = 200;
const WARMUP = 20;
const IPC_REPEAT = 50;

interface Stats {
  p50: number;
  p95: number;
  mean: number;
}

function bench(fn: () => void, repeat = REPEAT, warmup = WARMUP): Stats {
  for (let i = 0; i < warmup; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < repeat; i++) {
    const t = performance.now();
    fn();
    samples.push(performance.now() - t);
  }
  return summarize(samples);
}

/** 批量采样（用于低于计时精度的纯 JS 回退：每样本跑 batch 次再取均值） */
function benchBatched(
  fn: () => void,
  batch = 1000,
  repeat = 50,
  warmup = 5
): Stats {
  for (let i = 0; i < warmup; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < repeat; i++) {
    const t = performance.now();
    for (let j = 0; j < batch; j++) fn();
    samples.push((performance.now() - t) / batch);
  }
  return summarize(samples);
}

function summarize(samples: number[]): Stats {
  samples.sort((a, b) => a - b);
  const pick = (q: number): number =>
    samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
  return {
    p50: pick(0.5),
    p95: pick(0.95),
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
  };
}

const fmt = (s: Stats): string => {
  // < 10µs 时改用微秒展示（避免纯 JS 回退被 3 位小数抹成 0.000ms）
  const useUs = s.p50 < 0.01;
  const f = (ms: number): string =>
    useUs ? `${(ms * 1000).toFixed(2)}µs` : `${ms.toFixed(3)}ms`;
  return `P50 ${f(s.p50)} / P95 ${f(s.p95)} / mean ${f(s.mean)}`;
};

/** 确定性伪代码文本（ASCII，长度精确；避免随机噪声） */
function makeText(bytes: number): string {
  const line = 'const value = compute({ a: 1, b: [2, 3] }); // comment\n';
  return line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes);
}

type NativeLib = {
  estimateTokens?: (text: string, model?: string | null) => number;
  closeStructure?: (code: string, lang: string) => unknown;
  scanJsCalls?: (code: string) => unknown;
  analyzeBashCommand?: (command: string) => unknown;
  parseBashForSecurity?: (command: string) => unknown;
  readFileWithEncoding?: (path: string) => {
    encoding: string;
    content: string;
    error: string | null;
  };
};

function loadNative(): NativeLib | null {
  try {
    const mod = require('../native') as NativeLib | null;
    return mod && typeof mod === 'object' ? mod : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const native = loadNative();
  console.log('# U-25 liri-native 侧车化量化\n');
  console.log(
    `- 运行环境：${process.platform} / Bun ${process.versions.bun ?? 'n/a'}`
  );
  console.log(`- 采样：warmup ${WARMUP}，每项 ${REPEAT} 次\n`);

  if (!native) {
    console.log(
      '⚠️ 原生模块不可用（`require("../native")` 失败）⇒ **未实测**；' +
        '请先 `bun run build:native`（或等价命令）后重跑。'
    );
    return;
  }

  const sizes = [64 * 1024, 256 * 1024, 1024 * 1024];
  const texts = sizes.map((n) => makeText(n));

  // ① token 估算（热路径：compaction/utils.ts、TokenBudgetController）
  if (typeof native.estimateTokens === 'function') {
    console.log(
      '## 1. estimateTokens（原生直调 vs unified-JS 估算 vs chars/4 回退）'
    );
    for (let i = 0; i < sizes.length; i++) {
      const text = texts[i];
      const nativeStats = bench(() => native.estimateTokens?.(text));
      const unifiedStats = benchBatched(
        () => estimateMessagesTokens([{ role: 'user', content: text }]),
        50
      );
      const jsStats = benchBatched(() => Math.ceil(text.length / 4));
      console.log(
        `- ${(sizes[i] / 1024) | 0}KB：native ${fmt(nativeStats)} ｜ unified-JS ${fmt(unifiedStats)} ｜ chars/4 ${fmt(jsStats)}`
      );
    }
    console.log('');
  }

  // ② 结构闭合（热路径：SnipEngine 头尾截断）
  if (typeof native.closeStructure === 'function') {
    console.log('## 2. closeStructure（原生直调；无可比 JS 等价物）');
    for (const text of [texts[0], texts[1]]) {
      const stats = bench(() => native.closeStructure?.(text, 'ts'));
      console.log(`- ${(text.length / 1024) | 0}KB：${fmt(stats)}`);
    }
    console.log('');
  }

  // ③ code_run 静态校验 / bash 安全分析（短输入，热路径）
  if (typeof native.scanJsCalls === 'function') {
    const code = makeText(16 * 1024);
    console.log(
      `## 3. scanJsCalls（16KB）：${fmt(bench(() => native.scanJsCalls?.(code)))}\n`
    );
  }
  if (typeof native.analyzeBashCommand === 'function') {
    const cmd = 'ls -la && grep -rn "TODO" src | head -20';
    console.log(
      `## 4. analyzeBashCommand（短命令）：${fmt(bench(() => native.analyzeBashCommand?.(cmd)))}\n`
    );
  }
  if (typeof native.parseBashForSecurity === 'function') {
    const cmd = 'cat file.txt | grep foo > out.txt';
    console.log(
      `## 5. parseBashForSecurity（短命令）：${fmt(bench(() => native.parseBashForSecurity?.(cmd)))}\n`
    );
  }

  // ④ 文件读取：原生编码探测 vs fs UTF-8
  if (typeof native.readFileWithEncoding === 'function') {
    const dir = mkdtempSync(join(tmpdir(), 'liri-native-bench-'));
    try {
      const file = join(dir, 'sample.ts');
      writeFileSync(file, makeText(1024 * 1024), 'utf8');
      const nativeStats = bench(() => native.readFileWithEncoding?.(file), 50);
      const jsStats = bench(() => readFileSync(file, 'utf8'), 50);
      console.log('## 6. readFileWithEncoding（1MB UTF-8）');
      console.log(
        `- native ${fmt(nativeStats)} ｜ fs.readFileSync ${fmt(jsStats)}\n`
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ⑤ IPC 往返代理（侧车化增量 ≈ IPC − 原生直调）
  const dir = mkdtempSync(join(tmpdir(), 'liri-ipc-bench-'));
  let child: ReturnType<typeof fork> | undefined;
  try {
    const worker = join(dir, 'ipc-echo.mjs');
    writeFileSync(
      worker,
      "process.on('message', (m) => process.send?.({ echo: m }));\n"
    );
    child = fork(worker, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    await new Promise<void>((resolve) => child?.once('spawn', () => resolve()));
    const payload = 'x'.repeat(1024);
    const samples: number[] = [];
    for (let i = 0; i < IPC_REPEAT; i++) {
      const t = performance.now();
      await new Promise<void>((resolve) => {
        child?.once('message', () => resolve());
        child?.send({ i, payload });
      });
      samples.push(performance.now() - t);
    }
    samples.sort((a, b) => a - b);
    const pick = (q: number): number =>
      samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
    console.log('## 7. IPC 往返代理（1KB echo，fork + 消息）');
    console.log(
      `- P50 ${pick(0.5).toFixed(3)}ms / P95 ${pick(0.95).toFixed(3)}ms（n=${IPC_REPEAT}）\n`
    );
  } finally {
    child?.kill();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(
    '## 结论口径（CS03）\n' +
      '- 侧车化增量 ≈ IPC P50 − 原生直调 P50；若增量 > 2ms/次且崩溃率 < 0.1% ⇒ **不建议**侧车化。\n' +
      '- 本次仅给延迟面；崩溃率需真实日志统计，不在此脚本臆造。'
  );
}

void main();
