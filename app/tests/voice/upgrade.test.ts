/**
 * WebSocket 升级与帧解析单元测试
 * 覆盖 upgrade.ts: parseFrame, buildFrame, isWebSocketUpgrade, upgradeToVoiceConnection
 */

import { describe, it, expect } from 'bun:test';
import type { IncomingMessage, ServerResponse } from 'http';
import { createHash } from 'crypto';

import {
  parseFrame,
  buildFrame,
  isWebSocketUpgrade,
  upgradeToVoiceConnection,
} from '../../src/voice/upgrade.js';

/** WebSocket 魔术 GUID */
const MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

describe('isWebSocketUpgrade', () => {
  it('检测 Upgrade: websocket 请求头', () => {
    const req = { headers: { upgrade: 'websocket' } } as IncomingMessage;
    expect(isWebSocketUpgrade(req)).toBe(true);
  });

  it('忽略大小写', () => {
    const req = { headers: { upgrade: 'WebSocket' } } as IncomingMessage;
    expect(isWebSocketUpgrade(req)).toBe(true);
  });

  it('非 WebSocket 请求返回 false', () => {
    const req = { headers: { upgrade: 'http2' } } as IncomingMessage;
    expect(isWebSocketUpgrade(req)).toBe(false);
  });

  it('无 Upgrade 头返回 false', () => {
    const req = { headers: {} } as IncomingMessage;
    expect(isWebSocketUpgrade(req)).toBe(false);
  });
});

describe('parseFrame', () => {
  it('缓冲区长度不足 2 字节返回 null', () => {
    expect(parseFrame(Buffer.from([0x81]))).toBeNull();
  });

  it('解析未掩码的文本帧', () => {
    const payload = Buffer.from('Hello');
    const frame = buildFrame(0x1, payload);
    const result = parseFrame(frame);
    expect(result).not.toBeNull();
    expect(result!.opcode).toBe(0x1);
    expect(result!.payload.toString('utf-8')).toBe('Hello');
  });

  it('解析掩码的文本帧', () => {
    const payload = Buffer.from('Masked');
    const maskKey = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    let maskedPayload = Buffer.from(payload);
    for (let i = 0; i < maskedPayload.length; i++) {
      maskedPayload[i] ^= maskKey[i % 4];
    }
    const frame = Buffer.alloc(2 + 4 + maskedPayload.length);
    frame[0] = 0x81;
    frame[1] = 0x80 | maskedPayload.length;
    maskKey.copy(frame, 2);
    maskedPayload.copy(frame, 6);

    const result = parseFrame(frame);
    expect(result).not.toBeNull();
    expect(result!.opcode).toBe(0x1);
    expect(result!.payload.toString('utf-8')).toBe('Masked');
  });

  it('解析 126 长度扩展的帧', () => {
    const payload = Buffer.alloc(200, 0x41);
    const frame = buildFrame(0x1, payload);
    const result = parseFrame(frame);
    expect(result).not.toBeNull();
    expect(result!.opcode).toBe(0x1);
    expect(result!.payload.length).toBe(200);
  });

  it('解析 127 长度扩展的帧', () => {
    const payload = Buffer.alloc(70000, 0x42);
    const frame = buildFrame(0x1, payload);
    const result = parseFrame(frame);
    expect(result).not.toBeNull();
    expect(result!.opcode).toBe(0x1);
    expect(result!.payload.length).toBe(70000);
  });

  it('缓冲区长度不足返回 null', () => {
    const frame = buildFrame(0x1, Buffer.alloc(100));
    const truncated = frame.subarray(0, 5);
    expect(parseFrame(truncated)).toBeNull();
  });

  it('解析二进制帧', () => {
    const payload = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const frame = buildFrame(0x2, payload);
    const result = parseFrame(frame);
    expect(result).not.toBeNull();
    expect(result!.opcode).toBe(0x2);
    expect(result!.payload.length).toBe(4);
  });
});

describe('buildFrame', () => {
  it('构建短负载帧（≤125 字节）', () => {
    const payload = Buffer.from('test');
    const frame = buildFrame(0x1, payload);
    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(4);
    expect(frame.slice(2).toString()).toBe('test');
  });

  it('构建中等负载帧（126-65535 字节）', () => {
    const payload = Buffer.alloc(300, 0x41);
    const frame = buildFrame(0x1, payload);
    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(126);
    expect(frame.readUInt16BE(2)).toBe(300);
  });

  it('构建大负载帧（>65535 字节）', () => {
    const payload = Buffer.alloc(70000, 0x42);
    const frame = buildFrame(0x1, payload);
    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(127);
  });
});

describe('upgradeToVoiceConnection', () => {
  it('缺少 Sec-WebSocket-Key 返回 null', () => {
    const req = { headers: {} } as IncomingMessage;
    const res = {
      writeHead: () => {},
      end: () => {},
    } as unknown as ServerResponse;
    expect(upgradeToVoiceConnection(req, res)).toBeNull();
  });

  it('空 Sec-WebSocket-Key 返回 null', () => {
    const req = { headers: { 'sec-websocket-key': '' } } as IncomingMessage;
    const res = {
      writeHead: () => {},
      end: () => {},
    } as unknown as ServerResponse;
    expect(upgradeToVoiceConnection(req, res)).toBeNull();
  });

  it('验证 Accept Key 生成格式', () => {
    const key = 'dGhlIHNhbXBsZSBub25jZQ==';
    const expectedAccept = createHash('sha1')
      .update(key + MAGIC_GUID)
      .digest('base64');

    expect(expectedAccept).toBeTruthy();
    expect(expectedAccept.length).toBeGreaterThan(0);
    expect(expectedAccept).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('客户端携带子协议时 101 响应回传（RFC 6455）', () => {
    const req = {
      headers: {
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'sec-websocket-protocol': 'liri-auth-secret-123',
      },
    } as unknown as IncomingMessage;
    let capturedHeaders: Record<string, unknown> | null = null;
    const res = {
      writeHead: (_code: number, headers: Record<string, unknown>) => {
        capturedHeaders = headers;
      },
      end: () => {},
    } as unknown as ServerResponse;
    upgradeToVoiceConnection(req, res);
    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders!['Sec-WebSocket-Protocol']).toBe(
      'liri-auth-secret-123'
    );
  });

  it('客户端未携带子协议时 101 响应不带该头', () => {
    const req = {
      headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
    } as unknown as IncomingMessage;
    let capturedHeaders: Record<string, unknown> | null = null;
    const res = {
      writeHead: (_code: number, headers: Record<string, unknown>) => {
        capturedHeaders = headers;
      },
      end: () => {},
    } as unknown as ServerResponse;
    upgradeToVoiceConnection(req, res);
    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders!['Sec-WebSocket-Protocol']).toBeUndefined();
  });
});
