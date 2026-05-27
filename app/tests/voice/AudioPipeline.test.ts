/**
 * AudioPipeline 单元测试
 * 覆盖 PCMAudioBuffer 缓冲区管理、分片、格式转换
 */

import { describe, it, expect } from 'bun:test';

import {
  PCMAudioBuffer,
  AudioProcessor,
  AUDIO_FORMAT,
  DEFAULT_CHUNK_SIZE_BYTES,
} from '../../src/voice/AudioPipeline.js';

describe('PCMAudioBuffer', () => {

  it('初始统计为空', () => {
    const buf = new PCMAudioBuffer();
    const stats = buf.getStats();
    expect(stats.size).toBe(0);
    expect(stats.chunks).toBe(0);
    expect(stats.durationMs).toBe(0);
  });

  it('追加 Base64 数据并正确统计', () => {
    const buf = new PCMAudioBuffer();
    const pcmData = Buffer.alloc(3200, 0x00);
    buf.appendBase64(pcmData.toString('base64'));

    const stats = buf.getStats();
    expect(stats.size).toBe(3200);
    expect(stats.chunks).toBe(1);
  });

  it('追加原始 Buffer', () => {
    const buf = new PCMAudioBuffer();
    buf.appendBuffer(Buffer.alloc(1600, 0xff));

    const stats = buf.getStats();
    expect(stats.size).toBe(1600);
    expect(stats.chunks).toBe(1);
  });

  it('多次追加累积', () => {
    const buf = new PCMAudioBuffer();
    buf.appendBuffer(Buffer.alloc(800, 0x00));
    buf.appendBuffer(Buffer.alloc(800, 0x01));

    const stats = buf.getStats();
    expect(stats.size).toBe(1600);
    expect(stats.chunks).toBe(2);
  });

  it('toBuffer 返回合并数据', () => {
    const buf = new PCMAudioBuffer();
    buf.appendBuffer(Buffer.from([0x01, 0x02]));
    buf.appendBuffer(Buffer.from([0x03, 0x04]));

    const merged = buf.toBuffer();
    expect(merged.length).toBe(4);
    expect([...merged]).toEqual([0x01, 0x02, 0x03, 0x04]);
  });

  it('toBase64 返回编码数据', () => {
    const buf = new PCMAudioBuffer();
    buf.appendBuffer(Buffer.from('test'));

    expect(buf.toBase64()).toBe('dGVzdA==');
  });

  it('clear 重置所有状态', () => {
    const buf = new PCMAudioBuffer();
    buf.appendBuffer(Buffer.alloc(1600, 0x00));
    buf.clear();

    const stats = buf.getStats();
    expect(stats.size).toBe(0);
    expect(stats.chunks).toBe(0);
  });

  it('toChunks 切割为固定大小分片', () => {
    const buf = new PCMAudioBuffer();
    buf.appendBuffer(Buffer.alloc(6400, 0x00));

    const chunks = buf.toChunks(1600);
    expect(chunks.length).toBe(4);
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
    expect(chunks[0].byteLength).toBe(1600);
  });

  it('toChunks 使用默认分片大小', () => {
    const buf = new PCMAudioBuffer();
    const size = Math.floor(DEFAULT_CHUNK_SIZE_BYTES * 2.5);
    buf.appendBuffer(Buffer.alloc(size, 0x00));

    const chunks = buf.toChunks();
    expect(chunks.length).toBe(3);
  });

  it('bytesToMs 正确计算 PCM 时长', () => {
    const buf = new PCMAudioBuffer();
    const bytesPerSecond = AUDIO_FORMAT.SAMPLE_RATE * AUDIO_FORMAT.CHANNELS * AUDIO_FORMAT.BYTES_PER_SAMPLE;

    expect(buf.bytesToMs(bytesPerSecond)).toBeCloseTo(1000, -1);
    expect(buf.bytesToMs(bytesPerSecond * 2)).toBeCloseTo(2000, -1);
  });

  it('msToBytes 正确计算 PCM 字节数', () => {
    const buf = new PCMAudioBuffer();
    const bytesPerSecond = AUDIO_FORMAT.SAMPLE_RATE * AUDIO_FORMAT.CHANNELS * AUDIO_FORMAT.BYTES_PER_SAMPLE;

    expect(buf.msToBytes(1000)).toBe(bytesPerSecond);
    expect(buf.msToBytes(500)).toBe(Math.floor(bytesPerSecond / 2));
  });

  it('toChunks 序号连续递增', () => {
    const buf = new PCMAudioBuffer();
    buf.appendBuffer(Buffer.alloc(3200, 0x00));
    const first = buf.toChunks(1600);
    expect(first.length).toBe(2);
    expect(first[0].index).toBe(0);
    expect(first[1].index).toBe(1);

    buf.appendBuffer(Buffer.alloc(1600, 0x00));
    const second = buf.toChunks(1600);
    expect(second.length).toBe(3);
    expect(second[0].index).toBe(2);
    expect(second[1].index).toBe(3);
    expect(second[2].index).toBe(4);
  });
});

describe('AudioProcessor', () => {

  it('float32ToPcm16 转换Float32Array到PCM16', () => {
    const input = new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0]);
    const buffer = AudioProcessor.float32ToPcm16(input);

    expect(buffer.length).toBe(10);
    expect(buffer.readInt16LE(0)).toBeCloseTo(0, -100);
    expect(buffer.readInt16LE(2)).toBeGreaterThan(0);
    expect(buffer.readInt16LE(4)).toBeLessThan(0);
  });

  it('pcm16ToFloat32 转换PCM16到Float32Array', () => {
    const buffer = Buffer.alloc(6);
    buffer.writeInt16LE(0, 0);
    buffer.writeInt16LE(16384, 2);
    buffer.writeInt16LE(-16384, 4);

    const samples = AudioProcessor.pcm16ToFloat32(buffer);
    expect(samples.length).toBe(3);
    expect(samples[0]).toBeCloseTo(0, -2);
  });

  it('float32ToPcm16 和 pcm16ToFloat32 互逆', () => {
    const original = new Float32Array([0.0, 0.25, -0.25, 0.75, -0.75]);
    const buffer = AudioProcessor.float32ToPcm16(original);
    const restored = AudioProcessor.pcm16ToFloat32(buffer);

    expect(restored.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(restored[i] - original[i])).toBeLessThan(0.001);
    }
  });

  it('float32ToPcm16 裁剪超出范围的值', () => {
    const input = new Float32Array([2.0, -2.0]);
    const buffer = AudioProcessor.float32ToPcm16(input);

    expect(buffer.readInt16LE(0)).toBe(32767);
    expect(buffer.readInt16LE(2)).toBe(-32768);
  });

  it('estimateChunkCount 正确估算分片数', () => {
    expect(AudioProcessor.estimateChunkCount(100, 20)).toBe(5);
    expect(AudioProcessor.estimateChunkCount(101, 20)).toBe(6);
    expect(AudioProcessor.estimateChunkCount(0)).toBe(0);
  });
});
