/**
 * 语音端到端集成测试
 * 验证 WebSocket /voice 端点的升级握手与会话生命周期
 * 使用原始 net.Server 模拟 HTTP Server（避免 Node.js http.Server 对 WebSocket 升级的特殊处理）
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import * as net from 'net';
import type * as http from 'http';
import { handleVoiceUpgrade, getActiveVoiceSessionCount, closeAllVoiceSessions } from '../../src/voice/VoiceGatewayBridge.js';

/**
 * 创建 HTTP 请求对象和响应对象的模拟
 * 用于直接调用 handleVoiceUpgrade
 */
function createMockReqRes(path: string, upgradeHeader: string | undefined, wsKey: string | undefined) {
  const headers: Record<string, string | string[]> = {
    host: 'localhost',
    connection: upgradeHeader ? 'Upgrade' : 'close',
  };
  if (upgradeHeader) headers['upgrade'] = upgradeHeader;
  if (wsKey) headers['sec-websocket-key'] = wsKey;

  const req = {
    url: path,
    headers,
  } as http.IncomingMessage;

  const chunks: Buffer[] = [];
  let statusCode = 0;
  let responseHeaders: Record<string, string> = {};

  const res = {
    writeHead: (code: number, headers?: Record<string, string>) => {
      statusCode = code;
      if (headers) responseHeaders = { ...responseHeaders, ...headers };
    },
    end: (data?: string | Buffer) => {
      if (data) chunks.push(Buffer.from(data));
    },
    get statusCode() { return statusCode; },
    get responseHeaders() { return responseHeaders; },
    get body() { return Buffer.concat(chunks).toString(); },
  } as http.ServerResponse & { statusCode: number; responseHeaders: Record<string, string>; body: string };

  return { req, res };
}

/**
 * 通过原始 net.Server 搭建纯 TCP 服务
 * 手动解析 HTTP 请求并调用 handleVoiceUpgrade
 */
function createRawVoiceServer(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const srv = net.createServer((socket) => {
      let rawData = '';

      socket.on('data', (data) => {
        rawData += data.toString();
        const headerEnd = rawData.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;

        const headerSection = rawData.slice(0, headerEnd);
        const lines = headerSection.split('\r\n');
        const requestLine = lines[0];
        const [method, url] = requestLine.split(' ');

        // 解析请求头
        const headers: Record<string, string> = {};
        for (let i = 1; i < lines.length; i++) {
          const idx = lines[i].indexOf(':');
          if (idx !== -1) {
            headers[lines[i].slice(0, idx).trim().toLowerCase()] = lines[i].slice(idx + 1).trim();
          }
        }

        // 构建假的 req 和 res
        const req = {
          url,
          method,
          headers: {
            host: headers['host'] || 'localhost',
            upgrade: headers['upgrade'],
            connection: headers['connection'],
            'sec-websocket-key': headers['sec-websocket-key'],
            'sec-websocket-version': headers['sec-websocket-version'],
          },
          socket,
        } as unknown as http.IncomingMessage;

        let headWritten = false;
        let statusCode = 0;
        const resHeaders: Record<string, string> = {};
        const chunks: Buffer[] = [];

        const res = {
          writeHead: (code: number, h?: Record<string, string>) => {
            statusCode = code;
            if (h) Object.assign(resHeaders, h);
            headWritten = true;
            const reason = code === 101 ? 'Switching Protocols' : code === 426 ? 'Upgrade Required' : code === 400 ? 'Bad Request' : 'OK';
            const headerLines = [`HTTP/1.1 ${code} ${reason}`];
            for (const [k, v] of Object.entries(resHeaders)) {
              headerLines.push(`${k}: ${v}`);
            }
            headerLines.push('', '');
            socket.write(headerLines.join('\r\n'));
          },
          end: (data?: string | Buffer) => {
            if (!headWritten) {
              res.writeHead(200, { 'Content-Type': 'text/plain' });
            }
            if (data) chunks.push(Buffer.from(data));
            if (data) socket.write(Buffer.from(data));
            if (statusCode !== 101) {
              socket.end();
            }
          },
          get statusCode() { return statusCode; },
          get responseHeaders() { return resHeaders; },
          socket,
        } as unknown as http.ServerResponse & { statusCode: number; responseHeaders: Record<string, string> };

        if (url === '/voice') {
          const handled = handleVoiceUpgrade(req, res);
          if (!handled && statusCode !== 101) {
            // handleVoiceUpgrade 返回 false 时已写入响应
          }
          rawData = '';
        } else {
          res.writeHead(404);
          res.end('Not Found');
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

let rawServer: net.Server;
let rawPort: number;

beforeAll(async () => {
  closeAllVoiceSessions();

  const result = await createRawVoiceServer();
  rawServer = result.server;
  rawPort = result.port;
});

afterAll(() => {
  closeAllVoiceSessions();
  rawServer.close();
});

/**
 * 通过原始 TCP 连接发送 HTTP Upgrade 请求，返回响应头
 */
function rawWsUpgrade(path: string): Promise<{ statusCode: number; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const key = Buffer.from(Math.random().toString(36).slice(2, 18)).toString('base64');
    const socket = new net.Socket();

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('连接超时'));
    }, 3000);

    let rawData = '';

    socket.connect(rawPort, '127.0.0.1', () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
        `Host: localhost\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        `\r\n`
      );
    });

    socket.on('data', (data) => {
      clearTimeout(timeout);
      rawData += data.toString();

      const headerEnd = rawData.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const headerSection = rawData.slice(0, headerEnd);
        const lines = headerSection.split('\r\n');
        const statusLine = lines[0];
        const statusCode = parseInt(statusLine.split(' ')[1], 10);
        const headers: Record<string, string> = {};
        for (let i = 1; i < lines.length; i++) {
          const colonIdx = lines[i].indexOf(':');
          if (colonIdx !== -1) {
            const name = lines[i].slice(0, colonIdx).trim().toLowerCase();
            const value = lines[i].slice(colonIdx + 1).trim();
            headers[name] = value;
          }
        }
        resolve({ statusCode, headers });
        socket.end();
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe('Voice E2E: /voice 端点升级握手', () => {
  it('对 /voice 路径发送 WebSocket 升级请求返回 101', async () => {
    const { statusCode } = await rawWsUpgrade('/voice');
    expect(statusCode).toBe(101);
  });

  it('非 /voice 路径返回 404', async () => {
    const { statusCode } = await rawWsUpgrade('/other');
    expect(statusCode).toBe(404);
  });

  it('响应包含 Sec-WebSocket-Accept 头', async () => {
    const { headers } = await rawWsUpgrade('/voice');
    expect(headers['sec-websocket-accept']).toBeDefined();
    expect(typeof headers['sec-websocket-accept']).toBe('string');
    expect(headers['sec-websocket-accept'].length).toBeGreaterThan(0);
  });

  it('响应包含 Upgrade: websocket', async () => {
    const { headers } = await rawWsUpgrade('/voice');
    expect(headers['upgrade']?.toLowerCase()).toBe('websocket');
  });

  it('响应包含 Connection: Upgrade', async () => {
    const { headers } = await rawWsUpgrade('/voice');
    expect(headers['connection']?.toLowerCase()).toBe('upgrade');
  });
});

describe('Voice E2E: 会话生命周期', () => {
  it('升级成功后活跃会话数增加', async () => {
    closeAllVoiceSessions();
    const beforeCount = getActiveVoiceSessionCount();

    await rawWsUpgrade('/voice');
    const afterCount = getActiveVoiceSessionCount();
    expect(afterCount).toBe(beforeCount + 1);
  });

  it('closeAllVoiceSessions 清空所有会话', () => {
    closeAllVoiceSessions();
    expect(getActiveVoiceSessionCount()).toBe(0);
  });

  it('非 Upgrade 请求由 handleVoiceUpgrade 返回 426', () => {
    const { req, res } = createMockReqRes('/voice', undefined, 'test-key');
    const result = handleVoiceUpgrade(req, res);
    expect(result).toBe(false);
    expect(res.statusCode).toBe(426);
  });

  it('缺少 Sec-WebSocket-Key 返回 false', () => {
    const { req, res } = createMockReqRes('/voice', 'websocket', undefined);
    const result = handleVoiceUpgrade(req, res);
    expect(result).toBe(false);
    expect(res.statusCode).toBe(400);
  });
});

describe('Voice E2E: Bun WebSocket 原生连接', () => {
  beforeEach(() => {
    closeAllVoiceSessions();
  });

  it('通过原生 WebSocket 连接 /voice 成功', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${rawPort}/voice`);

    const result = await new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket 连接超时'));
      }, 3000);

      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    });

    expect(result).toBe(true);
  });

  it('多次独立连接各自独立', async () => {
    closeAllVoiceSessions();
    const ws1 = new WebSocket(`ws://127.0.0.1:${rawPort}/voice`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${rawPort}/voice`);

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('ws1 超时')), 3000);
        ws1.onopen = () => { clearTimeout(t); resolve(); };
      }),
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('ws2 超时')), 3000);
        ws2.onopen = () => { clearTimeout(t); resolve(); };
      }),
    ]);

    expect(getActiveVoiceSessionCount()).toBe(2);

    ws1.close();
    ws2.close();
  });

  it('非 /voice 路径被拒', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${rawPort}/other`);
    const result = await new Promise<boolean>((resolve) => {
      ws.onopen = () => { ws.close(); resolve(false); };
      ws.onerror = () => resolve(true);
    });
    expect(result).toBe(true);
  });
});
