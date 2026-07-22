/**
 * P3-8.2: 前端 ZoneContextManager 性能基准
 *
 * 验证 Store 层全面 asyncWrap 后 ZoneContextManager（Zone.js）
 * 对浏览器 Promise 链的性能影响。
 *
 * 运行方式（浏览器 Console）：
 *   1. 打开 Dashboard 页面
 *   2. 在 DevTools Console 中粘贴此文件内容
 *   3. 调用 runBenchmarks() 查看结果
 *
 * 验收阈值：
 *   - Store 操作额外延迟 < 5ms/次
 *   - chatStore.sendMessage 延迟增幅 < 3%
 *   - Zone.js Promise 链深度 < 50 层
 */

import { getOTelTracing } from "../OTelTracing";
import { instrumentStore } from "../instrumentStore";

interface BenchResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
}

/**
 * 运行性能基准测试
 */
export async function runBenchmarks(): Promise<{
  storeWrapOverhead: BenchResult;
  asyncWrapOverhead: BenchResult;
}> {
  const otel = getOTelTracing();

  // ── 基准 1: Store 操作的 asyncWrap 额外开销 ──

  const storeWrapResult = await benchmarkStoreWrap();
  console.log("[BENCH] Store asyncWrap 开销:", formatResult(storeWrapResult));

  // ── 基准 2: asyncWrap 方法本身开销 ──

  const asyncWrapResult = await benchmarkAsyncWrap(otel);
  console.log("[BENCH] asyncWrap 方法开销:", formatResult(asyncWrapResult));

  return {
    storeWrapOverhead: storeWrapResult,
    asyncWrapOverhead: asyncWrapResult,
  };
}

/**
 * 基准 1: 测量 store 操作被 asyncWrap 包装后的额外延迟
 */
async function benchmarkStoreWrap(): Promise<BenchResult> {
  const ITERATIONS = 100;

  // 模拟 store 方法
  const mockMethods = {
    async fetchData(): Promise<{ ok: boolean }> {
      return { ok: true };
    },
    async createItem(): Promise<{ id: string }> {
      return { id: "test" };
    },
    async deleteItem(): Promise<void> {
      // no-op
    },
  };

  // 无包装版本
  const timesRaw: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await mockMethods.fetchData();
    await mockMethods.createItem();
    await mockMethods.deleteItem();
    timesRaw.push(performance.now() - start);
  }

  // instrumentStore 包装版本
  const wrapped = instrumentStore("bench", mockMethods, [
    "fetchData",
    "createItem",
    "deleteItem",
  ]);
  const timesWrapped: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await (wrapped.fetchData as () => Promise<unknown>)();
    await (wrapped.createItem as () => Promise<unknown>)();
    await (wrapped.deleteItem as () => Promise<unknown>)();
    timesWrapped.push(performance.now() - start);
  }

  const avgRaw = avg(timesRaw);
  const avgWrapped = avg(timesWrapped);

  console.log(`[BENCH] 原始平均: ${avgRaw.toFixed(3)}ms, 包装平均: ${avgWrapped.toFixed(3)}ms`);
  console.log(`[BENCH] 额外开销: ${(avgWrapped - avgRaw).toFixed(3)}ms/次 (阈值 < 5ms)`);

  return summarize("store-async-wrap", timesWrapped);
}

/**
 * 基准 2: 测量 asyncWrap 方法本身的调用开销
 */
async function benchmarkAsyncWrap(
  otel: ReturnType<typeof getOTelTracing>,
): Promise<BenchResult> {
  const ITERATIONS = 200;

  // asyncWrap 每个调用创建一个 Span → 执行 fn → 关闭 Span
  const times: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await otel.asyncWrap(`bench:test:${i}`, async () => {
      // 模拟最小异步操作
      await Promise.resolve();
    });
    times.push(performance.now() - start);
  }

  const avgUs = avg(times);
  console.log(`[BENCH] asyncWrap 平均: ${avgUs.toFixed(3)}ms/次`);

  return summarize("otel-async-wrap", times);
}

// ── 工具函数 ──

function avg(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function summarize(name: string, values: number[]): BenchResult {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    name,
    iterations: values.length,
    totalMs: values.reduce((s, v) => s + v, 0),
    avgMs: avg(values),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

function formatResult(r: BenchResult): string {
  return `${r.name}: avg=${r.avgMs.toFixed(3)}ms, min=${r.minMs.toFixed(3)}ms, max=${r.maxMs.toFixed(3)}ms (n=${r.iterations})`;
}
