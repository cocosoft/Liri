#!/usr/bin/env bun
/**
 * Edge TTS 性能基准（语音系统升级 §7 验收项）
 *
 * 两项实测：
 *  1. TTS 首包延迟（createStream 从请求到首个音频块）验收 ≤ 800ms
 *  2. Edge WS 连接复用池收益（speak 连续同 voice，第 1 次新建 vs 后续复用）
 *
 * 用法：
 *  bun run scripts/bench-edge-tts.ts
 */

import { performance } from 'node:perf_hooks';
import { EdgeTTSProvider } from '../src/services/voice/services/edgeTTSProvider';

const TEXT =
  '大家好，欢迎使用 Liri 语音助手。今天天气晴朗，气温舒适，适合出门散步。';
const VOICE = 'zh-CN-XiaoxiaoNeural';
const N_STREAM = 8; // 首包延迟采样次数
const N_SPEAK = 5; // 复用池 speak 次数（第 1 次新建连接）

function p95(sorted: number[]): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

/** 实测 1：流式首包延迟 */
async function benchFirstPacket(): Promise<void> {
  console.log('=== 1. TTS 首包延迟（createStream，验收 ≤ 800ms）===');
  const latencies: number[] = [];
  for (let i = 0; i < N_STREAM; i++) {
    const provider = new EdgeTTSProvider({ voice: VOICE });
    const t0 = performance.now();
    try {
      await new Promise<void>((resolve, reject) => {
        const stream = provider.createStream({ text: TEXT, voice: VOICE });
        const timer = setTimeout(() => {
          stream.cancel();
          reject(new Error('首包超时 15s'));
        }, 15_000);
        let gotFirst = false;
        stream.onData((chunk, isLast) => {
          if (!gotFirst && chunk.length > 0) {
            gotFirst = true;
            latencies.push(performance.now() - t0);
            clearTimeout(timer);
          }
          if (isLast) resolve();
        });
        stream.onError((err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      console.log(`  #${i + 1}: ${latencies[latencies.length - 1].toFixed(0)}ms`);
    } catch (err) {
      console.error(`  #${i + 1} 失败: ${String(err)}`);
    } finally {
      provider.stop?.();
    }
  }
  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const p95v = p95(sorted);
    console.log(`\n  结果: 样本=${latencies.length} P50=${sorted[Math.floor(sorted.length / 2)].toFixed(0)}ms P95=${p95v.toFixed(0)}ms max=${Math.max(...latencies).toFixed(0)}ms`);
    console.log(`  验收: P95 ≤ 800ms → ${p95v <= 800 ? '✅ 通过' : '❌ 未通过'}`);
  }
}

/** 实测 2：WS 连接复用池收益（同 voice 连续 speak） */
async function benchPoolReuse(): Promise<void> {
  console.log('\n=== 2. Edge WS 复用池收益（同 voice 连续 speak）===');
  const provider = new EdgeTTSProvider({ voice: VOICE });
  const times: number[] = [];
  for (let i = 0; i < N_SPEAK; i++) {
    const t0 = performance.now();
    const r = await provider.speak({ text: TEXT, voice: VOICE });
    const elapsed = performance.now() - t0;
    if (!r.success) {
      console.error(`  #${i + 1} speak 失败: ${r.error}`);
      break;
    }
    times.push(elapsed);
    console.log(
      `  #${i + 1}: ${elapsed.toFixed(0)}ms (audio ${r.audioData?.length ?? 0}B)`
    );
  }
  provider.stop?.();
  if (times.length >= 2) {
    const first = times[0];
    const reusedAvg = times.slice(1).reduce((a, b) => a + b, 0) / (times.length - 1);
    const savePct = ((first - reusedAvg) / first) * 100;
    console.log(
      `\n  结果: 新建连接=${first.toFixed(0)}ms 复用平均=${reusedAvg.toFixed(0)}ms 收益=${savePct.toFixed(1)}% (${(first - reusedAvg).toFixed(0)}ms)`
    );
    console.log(`  验收: 复用显著提速 → ${savePct > 10 ? '✅ 收益显著' : savePct > 0 ? '✅ 有收益（<10%）' : '⚠️ 无收益'}`);
  }
}

async function main(): Promise<void> {
  await benchFirstPacket();
  await benchPoolReuse();
}

main().catch((err) => {
  console.error('基准执行失败:', err);
  process.exit(1);
});
