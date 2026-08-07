#!/usr/bin/env bun
/**
 * SenseVoice STT 端到端验证（TS 层 → Python worker 全链路）
 *
 * 覆盖：
 *  - SenseVoiceSTTProvider.isAvailable()
 *  - transcribe(): 合成 WAV → ensureWorker(spawn) → sendRequest(stdin/stdout 协议) → STTResult
 *
 * 用法：
 *  bun run scripts/verify-sensevoice.ts
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { SenseVoiceSTTProvider } from '../src/services/voice/services/senseVoiceSTTProvider';

/** 本环境 sherpa-onnx 装在项目 venv（真实部署用系统 Python，这里显式指定） */
function resolveVenvPython(): string | undefined {
  const candidates = [
    join(import.meta.dir, '..', '.venv', 'Scripts', 'python.exe'),
    join(import.meta.dir, '..', '.venv', 'bin', 'python3'),
  ];
  return candidates.find((p) => existsSync(p));
}

/** 构造 16kHz mono 16-bit PCM WAV（正弦波 + 谐波，模拟语音频谱） */
function synthWav(durationSec: number): Buffer {
  const sampleRate = 16000;
  const n = Math.floor(durationSec * sampleRate);
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  const fade = Math.floor(0.05 * sampleRate);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env =
      i < fade
        ? i / fade
        : i > n - fade
          ? (n - i) / fade
          : 1;
    const sample =
      env *
      (0.5 * Math.sin(2 * Math.PI * 220 * t) +
        0.25 * Math.sin(2 * Math.PI * 440 * t) +
        0.1 * Math.sin(2 * Math.PI * 880 * t));
    const clamped = Math.max(-1, Math.min(1, sample));
    buf.writeInt16LE(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, 44 + i * 2);
  }
  return buf;
}

async function main(): Promise<void> {
  console.log('=== SenseVoice 端到端验证 ===');

  const venvPython = resolveVenvPython();
  const provider = new SenseVoiceSTTProvider(
    venvPython ? { pythonCmd: venvPython } : {}
  );
  console.log(`pythonCmd: ${provider ? (venvPython ?? 'python(PATH)') : ''}`);
  console.log(`isAvailable(): ${provider.isAvailable()}`);

  const audio = synthWav(2.0);
  console.log(`合成测试音频: ${audio.length}B (2s, 16kHz mono PCM)`);

  console.log('调用 transcribe()...（首次含 worker 启动 + 模型加载）');
  const t0 = performance.now();
  const result = await provider.transcribe(audio, { language: 'zh' });
  const elapsed = performance.now() - t0;

  console.log(`耗时: ${elapsed.toFixed(0)}ms`);
  console.log(`result: text='${result.text}' confidence=${result.confidence} duration=${result.duration}s`);
  console.log(`provider=${result.provider} isFinal=${result.isFinal}`);

  if (result.error) {
    console.error(`❌ 转录失败: ${result.error.message}`);
    process.exit(1);
  }

  // 第二次调用（worker 已就绪，测复用链路）
  console.log('\n第二次调用（worker 复用，模型已加载）...');
  const t1 = performance.now();
  const result2 = await provider.transcribe(synthWav(2.0), { language: 'zh' });
  console.log(`耗时: ${(performance.now() - t1).toFixed(0)}ms`);
  console.log(`result2: text='${result2.text}'`);

  provider.dispose();
  console.log('\n✅ 端到端验证完成');
}

main().catch((err) => {
  console.error('端到端验证失败:', err);
  process.exit(1);
});
