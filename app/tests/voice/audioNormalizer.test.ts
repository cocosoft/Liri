/**
 * 音频归一化单元测试（语音系统升级 3.1 / P0-1）
 * 覆盖 detectAudioContainer magic bytes 嗅探 + normalizeAudioForSTT 的透传语义
 */

import { describe, it, expect } from 'bun:test';

import {
  detectAudioContainer,
  normalizeAudioForSTT,
  limitPcmDuration,
} from '../../src/services/voice/services/audioNormalizer.js';

describe('detectAudioContainer（magic bytes 嗅探）', () => {
  it('识别 WAV（RIFF....WAVE）', () => {
    const buf = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE'),
      Buffer.alloc(32),
    ]);
    expect(detectAudioContainer(buf)).toBe('wav');
  });

  it('识别 WebM（EBML 头 1A45DFA3）', () => {
    const buf = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      Buffer.alloc(16),
    ]);
    expect(detectAudioContainer(buf)).toBe('webm');
  });

  it('识别 Ogg（OggS）', () => {
    const buf = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(16)]);
    expect(detectAudioContainer(buf)).toBe('ogg');
  });

  it('识别 MP4（offset 4 处 ftyp）', () => {
    const buf = Buffer.alloc(24);
    buf.writeUInt32BE(24, 0);
    buf.write('ftyp', 4, 'latin1');
    expect(detectAudioContainer(buf)).toBe('mp4');
  });

  it('非容器数据返回 unknown（PCM16 原始字节）', () => {
    const buf = Buffer.alloc(1600, 0x00);
    expect(detectAudioContainer(buf)).toBe('unknown');
  });

  it('过短数据返回 unknown', () => {
    expect(detectAudioContainer(Buffer.from('RIFF'))).toBe('unknown');
    expect(detectAudioContainer(Buffer.alloc(0))).toBe('unknown');
  });
});

describe('normalizeAudioForSTT', () => {
  it('WAV 原样透传（不转码）', async () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE'),
      Buffer.alloc(32),
    ]);
    const result = await normalizeAudioForSTT(wav);
    expect(result.container).toBe('wav');
    expect(result.converted).toBe(false);
    expect(result.buffer).toBe(wav);
  });

  it('PCM 原始字节原样透传（不触发 ffmpeg）', async () => {
    const pcm = Buffer.alloc(3200, 0x00);
    const result = await normalizeAudioForSTT(pcm);
    expect(result.converted).toBe(false);
    expect(result.buffer).toBe(pcm);
  });
});

describe('limitPcmDuration（§6 长音频 30s 限长）', () => {
  it('未超限时原样返回', () => {
    const pcm = Buffer.alloc(30 * 16000 * 2); // 恰好 30s
    expect(limitPcmDuration(pcm)).toBe(pcm);
  });

  it('超过 30s 截断至前 30s（保留前段）', () => {
    const pcm = Buffer.alloc(30 * 16000 * 2 + 1600); // 30s + 50ms
    const limited = limitPcmDuration(pcm);
    expect(limited.length).toBe(30 * 16000 * 2);
    // 保留的是前段：首字节一致，尾部被截掉
    expect(limited[0]).toBe(0);
  });
});
