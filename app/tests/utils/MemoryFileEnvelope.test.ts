// MIT License
// Copyright (c) 2026 190615273@qq.com
import { describe, it, expect } from 'bun:test';
import {
  encodePayload,
  decodePayload,
  MEMORY_ENVELOPE_VERSION,
  COMPRESS_THRESHOLD,
} from '../../src/utils/MemoryFileEnvelope';

describe('MemoryFileEnvelope', () => {
  it('小文件不压缩（payload <= 阈值）', () => {
    const payload = JSON.stringify({ hello: 'world', n: 42 });
    expect(payload.length).toBeLessThan(COMPRESS_THRESHOLD);

    const encoded = encodePayload(payload);
    const parsed = JSON.parse(encoded);
    expect(parsed.version).toBe(MEMORY_ENVELOPE_VERSION);
    expect(parsed.compressed).toBe('none');

    const result = decodePayload(encoded);
    expect(result.status).toBe('envelope');
    if (result.status === 'envelope') {
      expect(result.payload).toBe(payload);
    }
  });

  it('大文件自动 gzip 压缩并可还原', () => {
    const payload = JSON.stringify({
      items: Array(200).fill({ id: 1, content: 'a'.repeat(20) }),
    });
    expect(payload.length).toBeGreaterThan(COMPRESS_THRESHOLD);

    const encoded = encodePayload(payload);
    const parsed = JSON.parse(encoded);
    expect(parsed.compressed).toBe('gzip');
    // gzip 后 base64 体积应小于明文体积（可压缩文本）
    expect(parsed.data.length).toBeLessThan(payload.length);

    const result = decodePayload(encoded);
    expect(result.status).toBe('envelope');
    if (result.status === 'envelope') {
      expect(result.payload).toBe(payload);
    }
  });

  it('兼容旧明文格式（无信封字段）', () => {
    const legacy = JSON.stringify({
      version: '1.0',
      timestamp: Date.now(),
      memories: [],
    });

    const result = decodePayload(legacy);
    expect(result.status).toBe('legacy');
    if (result.status === 'legacy') {
      expect(result.payload).toBe(legacy);
    }
  });

  it('非 JSON 内容按旧格式透传', () => {
    const raw = 'plain text content';
    const result = decodePayload(raw);
    expect(result.status).toBe('legacy');
    if (result.status === 'legacy') {
      expect(result.payload).toBe(raw);
    }
  });

  it('checksum 被篡改时识别为损坏', () => {
    const payload = JSON.stringify({ hello: 'world' });
    const encoded = encodePayload(payload);
    const envelope = JSON.parse(encoded);
    // 篡改 data 内容但保留原 checksum
    envelope.data = Buffer.from('tampered-content', 'utf-8').toString('base64');

    const result = decodePayload(JSON.stringify(envelope));
    expect(result.status).toBe('corrupt');
  });

  it('gzip 解压失败（data 非 base64）识别为损坏', () => {
    const envelope = {
      version: MEMORY_ENVELOPE_VERSION,
      checksum: 'deadbeef',
      compressed: 'gzip',
      data: '!!!not-base64!!!',
    };

    const result = decodePayload(JSON.stringify(envelope));
    expect(result.status).toBe('corrupt');
  });
});
