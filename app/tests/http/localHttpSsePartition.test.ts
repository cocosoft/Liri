/**
 * 多租户 P2：SSE 事件按身份路由
 *
 * 锁五件事（fail-closed）：
 *  ① 租户 A 的连接只收到 A 作用域内广播的事件，收不到本地/他人的；
 *  ② 本地（无作用域：CLI / cron / 后台 / 通道轮询）事件只投递给本地连接；
 *  ③ 断线补发（Last-Event-ID）同样按身份过滤 —— 否则重连即可拿到别人的事件；
 *  ④ 心跳对所有身份都发送（不含用户数据，不能把租户连接静默掐断）；
 *  ⑤ 每个连接登记的是**建立时**的身份（长连接不继承后续请求的 ALS 上下文）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type http from 'http';

import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope';
import {
  broadcastEvent,
  getSSEClientCount,
  handleEvents,
  stopSSE,
} from '../../src/infrastructure/http/LocalHTTPServiceSSE';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

interface FakeRes extends http.ServerResponse {
  chunks: string[];
}

function makeRes(): FakeRes {
  const chunks: string[] = [];
  return {
    chunks,
    writeHead: () => undefined,
    flushHeaders: () => undefined,
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    end: () => undefined,
  } as unknown as FakeRes;
}

function makeReq(
  url = '/',
  headers: Record<string, string> = {}
): http.IncomingMessage {
  return {
    url,
    headers,
    on: () => undefined,
  } as unknown as http.IncomingMessage;
}

/** 模拟一次 SSE 连接（`principal = null` ⇒ 本地身份/无作用域） */
async function connect(
  principal: Principal | null,
  url = '/'
): Promise<FakeRes> {
  const res = makeRes();
  const req = makeReq(url);
  if (principal)
    await runWithPrincipal(principal, () => handleEvents(req, res));
  else await handleEvents(req, res);
  return res;
}

function received(res: FakeRes): string {
  return res.chunks.join('');
}

beforeEach(() => {
  stopSSE();
});

afterEach(() => {
  stopSSE();
});

describe('SSE 按身份路由（P2）', () => {
  it('租户事件只投递给同身份连接；本地与其它租户收不到', async () => {
    const local = await connect(null);
    const alice = await connect(ALICE);
    const bob = await connect(BOB);
    expect(getSSEClientCount()).toBe(3);

    runWithPrincipal(ALICE, () =>
      broadcastEvent('chat:delta', { sessionId: 's-alice', text: 'hi' })
    );

    expect(received(alice)).toContain('event: chat:delta');
    expect(received(local)).toBe('');
    expect(received(bob)).toBe('');

    // 反向：本地/后台事件不推给远端身份
    broadcastEvent('cron:tick', { n: 1 });
    expect(received(local)).toContain('event: cron:tick');
    expect(received(alice)).not.toContain('event: cron:tick');
    expect(received(bob)).not.toContain('event: cron:tick');
  });

  it('同一租户的多个连接都收到（按身份而非按连接）', async () => {
    const alice1 = await connect(ALICE);
    const alice2 = await connect(ALICE);
    const bob = await connect(BOB);

    runWithPrincipal(ALICE, () => broadcastEvent('inbox:new', { id: 'i-1' }));

    expect(received(alice1)).toContain('event: inbox:new');
    expect(received(alice2)).toContain('event: inbox:new');
    expect(received(bob)).toBe('');
  });

  it('断线补发按身份过滤：只补自己的事件，别人的事件补不出来', async () => {
    broadcastEvent('local-1', { n: 1 }); // id 1
    runWithPrincipal(ALICE, () => broadcastEvent('alice-ev', { n: 2 })); // id 2
    broadcastEvent('local-2', { n: 3 }); // id 3

    const localReconnect = await connect(null, '/v1/events?lastEventId=1');
    expect(received(localReconnect)).toContain('event: local-2');
    expect(received(localReconnect)).not.toContain('event: alice-ev');

    const aliceReconnect = await runWithPrincipal(ALICE, async () => {
      const res = makeRes();
      await handleEvents(makeReq('/', { 'last-event-id': '1' }), res);
      return res;
    });
    expect(received(aliceReconnect)).toContain('event: alice-ev');
    expect(received(aliceReconnect)).not.toContain('event: local-2');
  });

  it('心跳对所有身份发送（不因身份过滤而饿死租户连接）', async () => {
    const realSetInterval = globalThis.setInterval;
    const realClearInterval = globalThis.clearInterval;
    let heartbeat: (() => void) | null = null;
    try {
      globalThis.setInterval = ((fn: () => void) => {
        heartbeat = fn;
        return { unref: () => {} };
      }) as unknown as typeof setInterval;
      globalThis.clearInterval = (() => {}) as unknown as typeof clearInterval;

      const local = await connect(null);
      const alice = await connect(ALICE);
      expect(heartbeat).not.toBeNull();

      heartbeat!();

      expect(received(local)).toContain('event: heartbeat');
      expect(received(alice)).toContain('event: heartbeat');
    } finally {
      globalThis.setInterval = realSetInterval;
      globalThis.clearInterval = realClearInterval;
    }
  });

  it('连接登记的是建立时身份：之后的作用域不会改变该连接的归属', async () => {
    const alice = await connect(ALICE);

    // 之后以 BOB 的身份广播 ⇒ alice 连接不应收到（长连接不继承后续请求上下文）
    runWithPrincipal(BOB, () => broadcastEvent('chat:delta', { text: 'bob' }));
    expect(received(alice)).toBe('');

    // 再以 ALICE 身份广播 ⇒ 仍然收到（归属在连接期固化）
    runWithPrincipal(ALICE, () => broadcastEvent('chat:delta', { text: 'a2' }));
    expect(received(alice)).toContain('"a2"');
  });
});
