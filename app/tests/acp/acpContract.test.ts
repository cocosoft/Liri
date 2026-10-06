/**
 * ACP 远程桥接契约测试（B-1 缺口，2026-10-06 新增）。
 *
 * 与 A2A 用例（`tests/http/a2aRoutes.test.ts`）**刻意不同**：ACP 是 **WebSocket 协议**
 * （`AcpWebSocketServer`），没有 HTTP 路由域。因此本用例**按实测实现**锁契约，
 * **不照搬** A2A 的 304/405/503 —— 那些码在 ACP 侧 0 命中（见计划 §19.2-U2）。
 *
 * 锁清单（每条对应实现行）：
 *   ① **默认关闭**：`port === 0` ⇒ `start()` 不监听（`healthCheck()` 真、客户端 0），且 `stop()` 安全；
 *   ② 非升级 HTTP：`GET {path}` ⇒ **426**（"requires WebSocket connection"）；其它路径 ⇒ **404**；
 *   ③ **鉴权**：配了 `authToken` ⇒ 缺失/错误的 `Authorization` ⇒ **401**；正确 ⇒ **101**；
 *      **未配 `authToken` ⇒ 放行**（回环信任基线，`AcpWebSocketServer.ts:188-191`）——
 *      ⚠️ 这与 A2A 的"专用密钥 + fail-closed"**不同**，勿照搬（台账 N-81）；
 *   ④ 协议错误码：非法 JSON ⇒ `error/'无效的 JSON 格式'`；未知类型 ⇒ `error/'未知消息类型: x'`；
 *      `run_turn` 未建会话 ⇒ `error/'会话未建立，请先调用 ensure_session'`；
 *   ⑤ 正常路径：`ping` ⇒ `pong`（带 `timestamp`）；`ensure_session` ⇒ `event(handle)` + `done(success)`；
 *      `run_turn` ⇒ `event(text_delta)` + `done(success)`。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as net from 'node:net';
import { createAcpWebSocketServer } from '../../src/acp/AcpWebSocketServer';
import { createInMemorySessionStore } from '../../src/acp/session';
import type { AcpRuntime } from '../../src/acp/runtime/types';

/** 最小可用 Runtime 替身（不触网、不落盘）—— 只实现桥接所需四方法 */
function createFakeRuntime(): AcpRuntime {
  return {
    async ensureSession(input) {
      return {
        sessionKey: input.sessionKey,
        backend: 'fake',
        runtimeSessionName: `fake:${input.sessionKey}`,
      };
    },
    async *runTurn(input) {
      yield { type: 'text_delta', text: `echo:${input.text}` };
    },
    async cancel() {
      // 无副作用
    },
    async close() {
      // 无副作用
    },
  };
}

/** 取一个空闲端口（先绑 0 探测，随即释放） */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

interface RawUpgrade {
  statusLine: string;
  text: string;
}

/** 原始 TCP 写升级请求（用于断言 401/101 —— 非 101 时 Bun WebSocket 只会 onerror） */
function rawUpgrade(
  port: number,
  extraHeaders: Record<string, string> = {}
): Promise<RawUpgrade> {
  return new Promise((resolve, reject) => {
    const key = Buffer.from('0123456789abcdef').toString('base64');
    const request = [
      'GET /acp HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      ...Object.entries(extraHeaders).map(([k, v]) => `${k}: ${v}`),
      '',
      '',
    ].join('\r\n');

    const socket = net.connect(port, '127.0.0.1', () => socket.write(request));
    let buf = '';
    socket.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf-8');
      const headEnd = buf.indexOf('\r\n\r\n');
      if (headEnd >= 0) {
        const statusLine = buf.slice(0, buf.indexOf('\r\n'));
        socket.destroy();
        resolve({ statusLine, text: buf });
      }
    });
    socket.on('error', reject);
    socket.setTimeout(3000, () => {
      socket.destroy();
      reject(new Error('原始升级请求超时'));
    });
  });
}

interface AcpTestClient {
  send(message: unknown): void;
  /** 发送**原始文本**（不 JSON 序列化）—— 用于非法 JSON 用例 */
  sendRaw(text: string): void;
  next(timeoutMs?: number): Promise<string>;
  close(): void;
}

/** 建立一条无鉴权 WS 连接，返回带消息队列的客户端 */
function connectClient(port: number): Promise<AcpTestClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/acp`);
  const queue: string[] = [];
  let waiter: {
    resolve: (v: string) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  function next(timeoutMs = 3000): Promise<string> {
    const head = queue.shift();
    if (head !== undefined) return Promise.resolve(head);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiter = null;
        reject(new Error('等待 ACP 消息超时'));
      }, timeoutMs);
      waiter = { resolve, reject, timer };
    });
  }

  ws.onmessage = (ev) => {
    const text = String(ev.data);
    if (waiter) {
      const pending = waiter;
      waiter = null;
      clearTimeout(pending.timer);
      pending.resolve(text);
    } else {
      queue.push(text);
    }
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('ACP WebSocket 连接超时')),
      3000
    );
    ws.onopen = () => {
      clearTimeout(timer);
      resolve({
        send: (message: unknown) => ws.send(JSON.stringify(message)),
        sendRaw: (text: string) => ws.send(text),
        next,
        close: () => ws.close(),
      });
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('ACP WebSocket 连接失败'));
    };
  });
}

const AUTH_TOKEN = 'test-acp-token';
let openPort = 0;
let authPort = 0;
let openServer: ReturnType<typeof createAcpWebSocketServer>;
let authServer: ReturnType<typeof createAcpWebSocketServer>;

beforeAll(async () => {
  openPort = await getFreePort();
  authPort = await getFreePort();

  openServer = createAcpWebSocketServer(
    createFakeRuntime(),
    { port: openPort, host: '127.0.0.1', path: '/acp' },
    createInMemorySessionStore()
  );
  authServer = createAcpWebSocketServer(
    createFakeRuntime(),
    { port: authPort, host: '127.0.0.1', path: '/acp', authToken: AUTH_TOKEN },
    createInMemorySessionStore()
  );

  await openServer.start();
  await authServer.start();
});

afterAll(async () => {
  await authServer.stop();
  await openServer.stop();
});

describe('ACP ① 默认关闭（port=0）', () => {
  it('port=0 ⇒ 不监听（healthCheck 真、客户端 0），stop 安全', async () => {
    const disabled = createAcpWebSocketServer(
      createFakeRuntime(),
      { port: 0 },
      createInMemorySessionStore()
    );
    await disabled.start();
    expect(await disabled.healthCheck()).toBe(true);
    expect(disabled.getClientCount()).toBe(0);
    await disabled.stop(); // 不抛
  });
});

describe('ACP ② 非升级 HTTP 请求', () => {
  it('GET {path} ⇒ 426；其它路径 ⇒ 404', async () => {
    const matched = await fetch(`http://127.0.0.1:${openPort}/acp`);
    expect(matched.status).toBe(426);
    expect(await matched.text()).toBe(
      'This endpoint requires WebSocket connection'
    );

    const other = await fetch(`http://127.0.0.1:${openPort}/other`);
    expect(other.status).toBe(404);
  });
});

describe('ACP ③ 升级鉴权', () => {
  it('配置 authToken：缺失 / 错误 Authorization ⇒ 401', async () => {
    const missing = await rawUpgrade(authPort);
    expect(missing.statusLine).toBe('HTTP/1.1 401 Unauthorized');

    const wrong = await rawUpgrade(authPort, {
      Authorization: 'Bearer wrong-token',
    });
    expect(wrong.statusLine).toBe('HTTP/1.1 401 Unauthorized');
  });

  it('配置 authToken：正确 Authorization ⇒ 101', async () => {
    const ok = await rawUpgrade(authPort, {
      Authorization: `Bearer ${AUTH_TOKEN}`,
    });
    expect(ok.statusLine).toBe('HTTP/1.1 101 Switching Protocols');
  });

  it('未配置 authToken ⇒ 放行（回环信任基线，与 A2A fail-closed 不同）', async () => {
    const open = await rawUpgrade(openPort);
    expect(open.statusLine).toBe('HTTP/1.1 101 Switching Protocols');
  });
});

describe('ACP ④⑤ 消息协议', () => {
  it('非法 JSON ⇒ error/"无效的 JSON 格式"（requestId=unknown）', async () => {
    const client = await connectClient(openPort);
    client.sendRaw('not-json');
    const reply = JSON.parse(await client.next()) as {
      type: string;
      requestId: string;
      payload: { message: string };
    };
    expect(reply.type).toBe('error');
    expect(reply.requestId).toBe('unknown');
    expect(reply.payload.message).toBe('无效的 JSON 格式');
    client.close();
  });

  it('ping ⇒ pong（带 timestamp）', async () => {
    const client = await connectClient(openPort);
    client.send({ type: 'ping', requestId: 'p1' });
    const reply = JSON.parse(await client.next()) as {
      type: string;
      requestId: string;
      payload: { timestamp: number };
    };
    expect(reply.type).toBe('pong');
    expect(reply.requestId).toBe('p1');
    expect(typeof reply.payload.timestamp).toBe('number');
    client.close();
  });

  it('未知消息类型 ⇒ error/"未知消息类型: bogus"', async () => {
    const client = await connectClient(openPort);
    client.send({ type: 'bogus', requestId: 'u1' });
    const reply = JSON.parse(await client.next()) as {
      type: string;
      payload: { message: string };
    };
    expect(reply.type).toBe('error');
    expect(reply.payload.message).toBe('未知消息类型: bogus');
    client.close();
  });

  it('run_turn 未先 ensure_session ⇒ error/"会话未建立…"', async () => {
    const client = await connectClient(openPort);
    client.send({ type: 'run_turn', requestId: 'r0', payload: { text: 'hi' } });
    const reply = JSON.parse(await client.next()) as {
      type: string;
      payload: { message: string };
    };
    expect(reply.type).toBe('error');
    expect(reply.payload.message).toBe('会话未建立，请先调用 ensure_session');
    client.close();
  });

  it('ensure_session ⇒ event(handle) + done(success)；run_turn ⇒ text_delta + done', async () => {
    const client = await connectClient(openPort);

    client.send({
      type: 'ensure_session',
      requestId: 's1',
      payload: { sessionKey: 'k1', agent: 'a1' },
    });
    const sessionEvent = JSON.parse(await client.next()) as {
      type: string;
      requestId: string;
      payload: { handle: { sessionKey: string } };
    };
    expect(sessionEvent.type).toBe('event');
    expect(sessionEvent.requestId).toBe('s1');
    expect(sessionEvent.payload.handle.sessionKey).toBe('k1');

    const sessionDone = JSON.parse(await client.next()) as {
      type: string;
      payload: { stopReason: string };
    };
    expect(sessionDone.type).toBe('done');
    expect(sessionDone.payload.stopReason).toBe('success');

    client.send({ type: 'run_turn', requestId: 't1', payload: { text: 'hi' } });
    const delta = JSON.parse(await client.next()) as {
      type: string;
      requestId: string;
      payload: { eventType: string; text: string };
    };
    expect(delta.type).toBe('event');
    expect(delta.requestId).toBe('t1');
    expect(delta.payload.eventType).toBe('text_delta');
    expect(delta.payload.text).toBe('echo:hi');

    const turnDone = JSON.parse(await client.next()) as {
      type: string;
      payload: { stopReason: string };
    };
    expect(turnDone.type).toBe('done');
    expect(turnDone.payload.stopReason).toBe('success');

    client.close();
  });
});
