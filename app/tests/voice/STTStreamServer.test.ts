/**
 * STTStreamServer 流式 STT 端点集成测试（语音系统升级 3.4 / P1-1）
 * 用原始 TCP + 手写 WS 帧验证升级握手、config/ready、binary→finalize→final 协议链路
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import net from 'net';
import http from 'http';

// patch STTRegistry.transcribe（模块单例），避免触发真实本地模型
import { STTRegistry } from '../../src/services/voice/services/sttRegistry.js';
import { upgradeSTTStreamConnection, closeAllSTTStreamSessions } from '../../src/voice/STTStreamServer.js';
import { parseFrame } from '../../src/voice/upgrade.js';

const transcribeCalls: Array<{ bytes: number; options?: unknown; providerId?: string }> = [];

const originalTranscribe = STTRegistry.transcribe.bind(STTRegistry);
const transcribeStub = async (
  audio: Buffer,
  options?: unknown,
  providerId?: string
): Promise<unknown> => {
  transcribeCalls.push({ bytes: audio.length, options, providerId });
  return { text: '流式识别测试结果', confidence: 0.95, segments: [], language: 'zh' };
};
STTRegistry.transcribe = transcribeStub as unknown as typeof STTRegistry.transcribe;

afterAll(() => {
  STTRegistry.transcribe = originalTranscribe;
});

/** 客户端掩码文本帧（客户端→服务端必须掩码） */
function clientTextFrame(payload: string): Buffer {
  const data = Buffer.from(payload, 'utf-8');
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];

  let header: Buffer;
  if (data.length <= 125) {
    header = Buffer.from([0x81, 0x80 | data.length]);
  } else if (data.length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(data.length, 6);
  }
  return Buffer.concat([header, mask, masked]);
}

/** 客户端掩码二进制帧 */
function clientBinaryFrame(payload: Buffer): Buffer {
  const mask = Buffer.from([0x55, 0x66, 0x77, 0x88]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];

  let header: Buffer;
  if (payload.length <= 125) {
    header = Buffer.from([0x82, 0x80 | payload.length]);
  } else if (payload.length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x82;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x82;
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(payload.length, 6);
  }
  return Buffer.concat([header, mask, masked]);
}

interface TestServer {
  server: net.Server;
  port: number;
}

/** 建原始 TCP server，/v1/voice/stt 升级分发到 STTStreamServer */
function createRawServer(): Promise<TestServer> {
  return new Promise((resolve) => {
    const srv = net.createServer((socket) => {
      let rawData = '';
      let upgradedOnce = false;
      socket.on('data', (data: Buffer) => {
        // 升级后不再处理：后续 WS 帧由 upgradeToVoiceConnection 注册的 socket data 监听处理
        if (upgradedOnce) return;
        rawData += data.toString('latin1');
        const headerEnd = rawData.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;

        const headerSection = rawData.slice(0, headerEnd);
        const firstLine = headerSection.split('\r\n')[0];
        const url = firstLine.split(' ')[1] || '/';
        const key = headerSection.match(/Sec-WebSocket-Key:\s*(.+)/i)?.[1]?.trim() ?? '';

        let headWritten = false;
        const res = {
          writeHead: (code: number, h?: Record<string, string>) => {
            headWritten = true;
            const reason = code === 101 ? 'Switching Protocols' : 'OK';
            const headerLines = [`HTTP/1.1 ${code} ${reason}`];
            for (const [k, v] of Object.entries(h ?? {})) {
              headerLines.push(`${k}: ${v}`);
            }
            headerLines.push('', '');
            socket.write(headerLines.join('\r\n'));
          },
          end: () => socket.end(),
          socket,
        } as unknown as http.ServerResponse;

        if (url === '/v1/voice/stt' && key) {
          upgradedOnce = true;
          upgradeSTTStreamConnection(
            { headers: { 'sec-websocket-key': key, upgrade: 'websocket' } } as unknown as http.IncomingMessage,
            res
          );
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });

    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        resolve({ server: srv, port: addr.port });
      }
    });
  });
}

/** 简易 WS 客户端：发送帧并收集服务端帧 */
function createWsClient(port: number): Promise<{
  sendText: (s: string) => void;
  sendBinary: (b: Buffer) => void;
  frames: Array<{ opcode: number; payload: Buffer }>;
  waitFor: (predicate: (f: { opcode: number; payload: Buffer }) => boolean, timeoutMs?: number) => Promise<{ opcode: number; payload: Buffer }>;
}> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let upgraded = false;
    let rawBuf = Buffer.alloc(0);
    const frames: Array<{ opcode: number; payload: Buffer }> = [];
    const waiters: Array<{ pred: (f: { opcode: number; payload: Buffer }) => boolean; resolve: (f: { opcode: number; payload: Buffer }) => void; timer: ReturnType<typeof setTimeout> }> = [];
    // 握手完成前发送的帧排队，避免在服务端注册 data 监听前丢失
    const pendingSends: Buffer[] = [];
    const flushPending = (): void => {
      while (pendingSends.length > 0) socket.write(pendingSends.shift()!);
    };

    const key = Buffer.from('testkey1234567890').toString('base64');

    socket.connect(port, '127.0.0.1', () => {
      socket.write(
        `GET /v1/voice/stt HTTP/1.1\r\n` +
        `Host: localhost\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        `\r\n`
      );
    });

    const checkWaiters = (frame: { opcode: number; payload: Buffer }): void => {
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        if (w.pred(frame)) {
          clearTimeout(w.timer);
          waiters.splice(i, 1);
          w.resolve(frame);
        }
      }
    };

    socket.on('data', (data: Buffer) => {
      rawBuf = Buffer.concat([rawBuf, data]);
      if (!upgraded) {
        const headerEnd = rawBuf.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const headerSection = rawBuf.slice(0, headerEnd).toString('utf-8');
        if (!headerSection.includes('101')) {
          reject(new Error(`升级失败: ${headerSection.split('\r\n')[0]}`));
          socket.destroy();
          return;
        }
        upgraded = true;
        rawBuf = rawBuf.subarray(headerEnd + 4);
        flushPending();
      }

      // 解析服务端帧（不掩码）
      while (true) {
        const frame = parseFrame(rawBuf);
        if (!frame) break;
        rawBuf = rawBuf.subarray(frame.totalLength);
        frames.push({ opcode: frame.opcode, payload: frame.payload });
        checkWaiters({ opcode: frame.opcode, payload: frame.payload });
      }
    });

    socket.on('error', (err) => reject(err));

    resolve({
      sendText: (s: string) => {
        const frame = clientTextFrame(s);
        if (upgraded) socket.write(frame);
        else pendingSends.push(frame);
      },
      sendBinary: (b: Buffer) => {
        const frame = clientBinaryFrame(b);
        if (upgraded) socket.write(frame);
        else pendingSends.push(frame);
      },
      frames,
      waitFor: (pred, timeoutMs = 3000) =>
        new Promise((res2, rej2) => {
          const existing = frames.find(pred);
          if (existing) {
            res2(existing);
            return;
          }
          const timer = setTimeout(() => {
            const idx = waiters.findIndex((w) => w.pred === pred);
            if (idx !== -1) waiters.splice(idx, 1);
            rej2(
              new Error(
                `等待帧超时，已收到 ${frames.length} 帧: ${frames
                  .map((f) => f.payload.toString('utf-8').slice(0, 80))
                  .join(' | ')}`
              )
            );
          }, timeoutMs);
          waiters.push({ pred, resolve: res2, timer });
        }),
    });
  });
}

let rawServer: net.Server;
let rawPort: number;

beforeAll(async () => {
  closeAllSTTStreamSessions();
  const result = await createRawServer();
  rawServer = result.server;
  rawPort = result.port;
});

afterAll(() => {
  closeAllSTTStreamSessions();
  rawServer.close();
});

describe('3.4 STTStreamServer 流式 STT 端点', () => {
  it('升级握手成功后 config → ready', async () => {
    const client = await createWsClient(rawPort);
    client.sendText(JSON.stringify({ type: 'config', language: 'zh-CN', providerId: 'local' }));

    const ready = await client.waitFor((f) => {
      try {
        return JSON.parse(f.payload.toString('utf-8')).type === 'ready';
      } catch {
        return false;
      }
    });
    expect(JSON.parse(ready.payload.toString('utf-8')).type).toBe('ready');
  });

  it('推流 PCM 后 finalize 返回最终转录（同一链路）', async () => {
    transcribeCalls.length = 0;
    const client = await createWsClient(rawPort);
    client.sendText(JSON.stringify({ type: 'config', language: 'zh-CN' }));

    await client.waitFor((f) => {
      try {
        return JSON.parse(f.payload.toString('utf-8')).type === 'ready';
      } catch {
        return false;
      }
    });

    // 推 32000 字节 PCM（约 1s 16kHz mono），然后 finalize
    client.sendBinary(Buffer.alloc(32000, 0x00));
    client.sendText(JSON.stringify({ type: 'finalize' }));

    const final = await client.waitFor((f) => {
      try {
        return JSON.parse(f.payload.toString('utf-8')).type === 'final';
      } catch {
        return false;
      }
    }, 5000);

    const finalMsg = JSON.parse(final.payload.toString('utf-8'));
    expect(finalMsg.type).toBe('final');
    expect(finalMsg.text).toBe('流式识别测试结果');
    expect(transcribeCalls.length).toBeGreaterThanOrEqual(1);
    // 最终转录与 interim 走同一 STTRegistry 链路
    expect(transcribeCalls[transcribeCalls.length - 1].bytes).toBe(32000);
  });

  it('abort 关闭会话且不再转写', async () => {
    transcribeCalls.length = 0;
    const client = await createWsClient(rawPort);
    client.sendText(JSON.stringify({ type: 'config' }));
    await client.waitFor((f) => {
      try {
        return JSON.parse(f.payload.toString('utf-8')).type === 'ready';
      } catch {
        return false;
      }
    });

    client.sendText(JSON.stringify({ type: 'abort' }));
    // abort 后连接关闭，不再产生转写调用
    await new Promise((r) => setTimeout(r, 200));
    expect(transcribeCalls.length).toBe(0);
  });

  it('超过 30s 音频滑窗限长，finalize 只转写最近 30s（内存保护）', async () => {
    transcribeCalls.length = 0;
    const client = await createWsClient(rawPort);
    client.sendText(JSON.stringify({ type: 'config' }));
    await client.waitFor((f) => {
      try {
        return JSON.parse(f.payload.toString('utf-8')).type === 'ready';
      } catch {
        return false;
      }
    });

    // 推 1200000 字节（≈37.5s），超过 MAX_TRANSCRIBE_SECONDS=30 限长（960000 字节）
    client.sendBinary(Buffer.alloc(1200000, 0x00));
    client.sendText(JSON.stringify({ type: 'finalize' }));

    const final = await client.waitFor((f) => {
      try {
        return JSON.parse(f.payload.toString('utf-8')).type === 'final';
      } catch {
        return false;
      }
    }, 5000);

    expect(JSON.parse(final.payload.toString('utf-8')).type).toBe('final');
    // 滑窗后只保留最近 30s：30 * 16000 * 2 = 960000 字节
    expect(transcribeCalls[transcribeCalls.length - 1].bytes).toBe(960000);
  });
});
