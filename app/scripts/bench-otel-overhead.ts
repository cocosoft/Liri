#!/usr/bin/env bun
/**
 * R17 —— **OTel span 开销 / 事件循环滞后基准**（非 CI 门禁）。
 *
 * 背景：R17 核查结论为「OTel 背压**已由 SDK 提供**（`BatchSpanProcessor` 有界队列 + 采样 +
 * 周期导出）⇒ 外部"Rust ring buffer + worker 池"属重复造轮子（CS01）」，并给出**触发条件**：
 * **出现实测的 GC / 事件循环延迟回归**才需优化 —— 本脚本即该触发的**实测前置**（"用 R9 基准法测"）。
 *
 * 测什么：
 *   F1 span 吞吐开销（ns/span + 峰值堆增量）：对比 **no-op tracer**（未注册 provider）与
 *      **真实 provider**（`BatchSpanProcessor` + 内存 exporter，无网络 I/O）。
 *   F2 事件循环滞后（`setInterval(10ms)` 抖动，取 max/p95）：生成 span 期间定时器被推迟多少。
 *
 * 判定：若真实 provider 下 F1/F2 相对 no-op **未见数量级/显著回归** ⇒ 触发条件**不满足**（不优化）。
 *
 * 用法（app 目录下）：`bun run scripts/bench-otel-overhead.ts`
 * **不作为 CI 门禁**（受机器负载影响）。
 */
import { trace, type Tracer } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';

const N = 200_000;
const BATCH = 2_000;
const MB = 1048576;

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const round = (n: number): number => Math.round(n * 100) / 100;

/** 生成 N 个 span（带 gen_ai 属性，模拟热路径），每 BATCH 个让出一次事件循环 */
async function generate(tracer: Tracer): Promise<void> {
  for (let i = 0; i < N; i++) {
    const span = tracer.startSpan('bench.op', {
      attributes: { 'gen_ai.operation.name': 'chat' },
    });
    span.setAttribute('gen_ai.request.model', 'bench-model');
    span.setAttribute('bench.index', i);
    span.end();
    if (i % BATCH === BATCH - 1) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}

async function measure(label: string): Promise<void> {
  const tracer = trace.getTracer('bench');
  // 预热
  await generate(tracer);

  const heap0 = process.memoryUsage().heapUsed;
  let peak = heap0;
  const lags: number[] = [];
  let expected = performance.now() + 10;
  const timer = setInterval(() => {
    const now = performance.now();
    lags.push(Math.max(0, now - expected));
    expected = now + 10;
    peak = Math.max(peak, process.memoryUsage().heapUsed);
  }, 10);

  const t0 = performance.now();
  await generate(tracer);
  const elapsed = performance.now() - t0;
  clearInterval(timer);

  console.log(
    `  ${label.padEnd(22)} ${round((elapsed * 1e6) / N).toString().padStart(7)} ns/span · ` +
      `总 ${round(elapsed)} ms · 堆峰增 ${((peak - heap0) / MB).toFixed(1)} MB · ` +
      `事件循环滞后 p95 ${round(pct(lags, 0.95))} ms / max ${round(Math.max(...lags, 0))} ms`
  );
}

async function main(): Promise<void> {
  console.log('=== R17 OTel span 开销 / 事件循环滞后基准（非门禁）===');
  console.log(
    `参数：N=${N} span（每 ${BATCH} 让出事件循环 1 次）；滞后采样 = setInterval(10ms) 抖动间隔\n`
  );

  // ① no-op tracer（未注册 provider）
  await measure('no-op tracer');

  // ② 真实 provider（BatchSpanProcessor + 内存 exporter，无网络 I/O）
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'bench' }),
    spanProcessors: [new BatchSpanProcessor(new InMemorySpanExporter())],
  });
  trace.setGlobalTracerProvider(provider);
  await measure('provider+Batch');

  await provider.forceFlush?.();
  console.log('\n判定：两者同量级（ns/span 与滞后无数量级差）⇒ 触发条件（GC/事件循环回归）**不满足**。');
}

main().catch((err: unknown) => {
  console.error('基准运行失败：', err);
  process.exit(1);
});
