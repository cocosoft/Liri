/**
 * IRC 协议桩（2026-11-01，非 HTTP 通道第二条）。
 *
 * IRC 走原始 TCP：连接后 `NICK` + `USER`，服务端回 `001` 才算就绪，之后 `PRIVMSG <target> :<text>`。
 * 本用例起**本机临时 IRC 服务**（127.0.0.1 随机端口），断言：
 *   ① 注册握手顺序（NICK/USER 后才允许发消息）；
 *   ② `PRIVMSG #chan :你好` 的目标与正文形状；
 *   ③ 超长文本按段拆分（多条 PRIVMSG，不截断丢弃）；
 *   ④ 未连接时明确失败（不静默吞）。
 */
import { describe, expect, it, afterEach } from 'bun:test';
import { createServer, type Server, type Socket } from 'node:net';
import { createIrcChannel } from '../../src/channels/irc/IrcChannel';

interface IrcStub {
  server: Server;
  port: number;
  lines: string[];
  /** 已建立的连接（afterEach 先销毁，否则 server.close 会等连接自然断开） */
  sockets: Set<Socket>;
}

function startIrcStub(): Promise<IrcStub> {
  const lines: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket: Socket) => {
    sockets.add(socket);
    socket.setEncoding('utf-8');
    let buffer = '';

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        lines.push(line);

        if (line.startsWith('NICK')) continue;
        if (line.startsWith('USER')) {
          // 客户端 NICK → USER 之后回 001，完成注册（IRC 的最小握手）
          socket.write(':stub 001 Liri_bot :Welcome to the stub network\r\n');
          continue;
        }
        if (line.startsWith('PING')) {
          socket.write(`:stub PONG stub :${line.slice(5)}\r\n`);
        }
      }
    });
    socket.on('error', () => {
      /* 测试内忽略连接错误 */
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port, lines, sockets });
    });
  });
}

let stub: IrcStub | null = null;

afterEach(async () => {
  if (!stub) return;
  for (const socket of stub.sockets) socket.destroy();
  await new Promise<void>((resolve) => stub!.server.close(() => resolve()));
  stub = null;
});

/** 等桩服务「收到」指定行（TCP 写入是异步的，断言前必须等它真的到达） */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1000
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function connected(
  port: number
): Promise<ReturnType<typeof createIrcChannel>> {
  const ch = createIrcChannel();
  await ch.lifecycle.connect({
    server: '127.0.0.1',
    port,
    nickname: 'Liri_bot',
    channels: [],
  });
  return ch;
}

describe('IRC 协议桩', () => {
  it('握手：先 NICK/USER，注册（001）后才发 PRIVMSG', async () => {
    stub = await startIrcStub();
    const ch = await connected(stub.port);

    const r = await ch.outbound.sendText('#test', '你好');
    await waitFor(() => stub!.lines.some((l) => l.startsWith('PRIVMSG ')));

    expect(r.success).toBe(true);
    const nickIdx = stub.lines.findIndex((l) => l.startsWith('NICK '));
    const userIdx = stub.lines.findIndex((l) => l.startsWith('USER '));
    const privIdx = stub.lines.findIndex((l) => l.startsWith('PRIVMSG '));
    expect(nickIdx).toBeGreaterThanOrEqual(0);
    expect(userIdx).toBeGreaterThan(nickIdx);
    expect(privIdx).toBeGreaterThan(userIdx);
    expect(stub.lines[privIdx]).toBe('PRIVMSG #test :你好');

    await ch.lifecycle.disconnect();
  });

  it('超长文本 ⇒ 拆成多条 PRIVMSG（目标一致，不丢尾）', async () => {
    stub = await startIrcStub();
    const ch = await connected(stub.port);

    const long = 'a'.repeat(400);
    const r = await ch.outbound.sendText('#test', long);
    await waitFor(
      () => stub!.lines.filter((l) => l.startsWith('PRIVMSG ')).length > 1
    );

    expect(r.success).toBe(true);
    const privs = stub.lines.filter((l) => l.startsWith('PRIVMSG '));
    expect(privs.length).toBeGreaterThan(1);
    expect(privs.every((l) => l.startsWith('PRIVMSG #test :'))).toBe(true);
    const body = privs.map((l) => l.slice('PRIVMSG #test :'.length)).join('');
    expect(body).toBe(long);

    await ch.lifecycle.disconnect();
  });

  it('未连接 ⇒ success=false 且给出原因（不静默）', async () => {
    const ch = createIrcChannel();
    const r = await ch.outbound.sendText('#test', 'hi');

    expect(r.success).toBe(false);
    expect(r.error).toContain('IRC 未连接');
  });
});
