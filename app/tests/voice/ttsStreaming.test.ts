/**
 * TTS 流式合成 + 缓存键 + 队列单元测试（语音系统升级第二批 3.5/3.6/3.7）
 * 覆盖 speakStreaming 分片回调/中断、缓存键含 Provider、队列默认启用
 */

import { describe, it, expect, afterEach } from 'bun:test';

import { TTSRegistry } from '../../src/services/voice/services/ttsProvider.js';
import type {
  TTSSpeakOptions,
  TTSSpeakResult,
  TTSProvider,
} from '../../src/services/voice/services/ttsTypes.js';

/** 记录调用与文本的 mock Provider */
interface SpeakCall {
  provider: string;
  text: string;
}

const calls: SpeakCall[] = [];

function makeMockProvider(
  name: string,
  opts?: { delayMs?: number; failText?: string }
): TTSProvider {
  return {
    name,
    supportedFormats: ['wav'],
    getVoices: () => [],
    speak: async (options: TTSSpeakOptions): Promise<TTSSpeakResult> => {
      calls.push({ provider: name, text: options.text });
      if (opts?.delayMs) {
        await new Promise((r) => setTimeout(r, opts.delayMs));
      }
      if (opts?.failText && options.text.includes(opts.failText)) {
        return { success: false, error: 'mock 合成失败' };
      }
      return {
        success: true,
        audioData: Buffer.alloc(1600),
        audioFormat: 'wav',
      };
    },
  };
}

/** 生成超过 1000 字符的长文本（触发 ChunkedSynthesizer 分片） */
function longText(): string {
  return Array.from({ length: 220 }, (_, i) => `第${i + 1}句内容。`).join('');
}

afterEach(() => {
  for (const p of TTSRegistry.getProviderNames()) {
    TTSRegistry.unregister(p);
  }
  TTSRegistry.configureQueue({ enabled: true, concurrency: 1 });
  calls.length = 0;
});

describe('3.7 队列默认启用', () => {
  it('TTSPriorityQueue 默认 enabled = true（3.7/P2-4）', () => {
    const stats = TTSRegistry.getQueueStats();
    expect(stats.enabled).toBe(true);
  });
});

describe('3.5 speakStreaming 流式合成', () => {
  it('单片文本（≤1000 字符）回调一次', async () => {
    TTSRegistry.register(makeMockProvider('mock-single'));
    const received: Array<{ index: number; total: number }> = [];

    const result = await TTSRegistry.speakStreaming(
      { text: '你好世界' },
      (_chunk, index, total) => {
        received.push({ index, total });
      },
      'mock-single'
    );

    expect(result.success).toBe(true);
    expect(received).toEqual([{ index: 0, total: 1 }]);
  });

  it('长文本分片后逐片回调（顺序 + total 正确）', async () => {
    TTSRegistry.register(makeMockProvider('mock-chunk'));
    const indices: number[] = [];

    const result = await TTSRegistry.speakStreaming(
      { text: longText() },
      (_chunk, index, total) => {
        indices.push(index);
        expect(total).toBeGreaterThan(1);
      },
      'mock-chunk'
    );

    expect(result.success).toBe(true);
    expect(indices.length).toBeGreaterThan(1);
    // 回调按 0..n-1 顺序到达（流式顺序保证）
    expect(indices).toEqual(indices.map((_, i) => i));
  });

  it('signal 已 abort 时直接返回取消错误（3.7/P2-4 中断透传）', async () => {
    TTSRegistry.register(makeMockProvider('mock-abort'));
    const controller = new AbortController();
    controller.abort();

    const result = await TTSRegistry.speakStreaming(
      { text: longText(), signal: controller.signal },
      () => {},
      'mock-abort'
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('取消');
  });

  it('abort 中断进行中的流式合成（不再合成后续分片）', async () => {
    TTSRegistry.register(makeMockProvider('mock-midabort', { delayMs: 30 }));
    const controller = new AbortController();

    const resultPromise = TTSRegistry.speakStreaming(
      { text: longText(), signal: controller.signal },
      async () => {
        // 第一片回调后立即中断
        controller.abort();
      },
      'mock-midabort'
    );

    const result = await resultPromise;
    // 中断后返回取消错误或部分成功（取决于时序），但后续分片不再合成
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(result.success).toBe(false);
  });
});

describe('3.6 缓存键含 Provider', () => {
  it('相同文本+语音+语速在不同 Provider 下各自合成（不互相污染）', async () => {
    TTSRegistry.register(makeMockProvider('mock-p1'));
    TTSRegistry.register(makeMockProvider('mock-p2'));

    // 相同合成参数，但 Provider 不同 → 两个 Provider 都必须被调用（缓存键含 provider）
    const opts1: TTSSpeakOptions = { text: '跨 Provider 缓存测试', voice: 'zh-CN-X', speed: 1.0 };
    const opts2: TTSSpeakOptions = { text: '跨 Provider 缓存测试', voice: 'zh-CN-X', speed: 1.0 };

    await TTSRegistry.speakInternal(opts1, 'mock-p1', true);
    await TTSRegistry.speakInternal(opts2, 'mock-p2', true);

    const p1Calls = calls.filter((c) => c.provider === 'mock-p1');
    const p2Calls = calls.filter((c) => c.provider === 'mock-p2');
    expect(p1Calls.length).toBe(1);
    expect(p2Calls.length).toBe(1);
  });

  it('相同 Provider 下相同参数命中缓存（不再重复合成）', async () => {
    TTSRegistry.register(makeMockProvider('mock-cachehit'));

    const opts: TTSSpeakOptions = { text: '缓存命中测试文本', voice: 'zh-CN-X', speed: 1.0 };
    await TTSRegistry.speakInternal(opts, 'mock-cachehit', true); // 首次合成
    await TTSRegistry.speakInternal(opts, 'mock-cachehit', false); // 命中缓存

    const pCalls = calls.filter((c) => c.provider === 'mock-cachehit');
    expect(pCalls.length).toBe(1);
  });
});
