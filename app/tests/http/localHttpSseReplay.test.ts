/**
 * U-04 残余（2026-10-19）：SSE 事件级断线补发（Last-Event-ID）。
 *
 * 覆盖：
 * - 广播事件带单调递增 `id:`
 * - 重连携带 `Last-Event-ID` ⇒ 只补发其后的事件（顺序与 id 一致）
 * - 无 `Last-Event-ID` ⇒ 不补发（新连接语义）
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type http from 'http';
import {
  broadcastEvent,
  handleEvents,
  stopSSE,
} from '../../src/infrastructure/http/LocalHTTPServiceSSE';

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
  url: string,
  headers: Record<string, string> = {}
): http.IncomingMessage {
  return {
    url,
    headers,
    on: () => undefined,
  } as unknown as http.IncomingMessage;
}

beforeEach(() => {
  stopSSE();
});

afterEach(() => {
  stopSSE();
});

describe('SSE 事件级补发（Last-Event-ID）', () => {
  it('广播事件带 id；重连带 Last-Event-ID ⇒ 只补发其后事件', async () => {
    broadcastEvent('a', { n: 1 });
    broadcastEvent('b', { n: 2 });
    broadcastEvent('c', { n: 3 });

    const res = makeRes();
    await handleEvents(makeReq('/', { 'last-event-id': '1' }), res);
    const joined = res.chunks.join('');

    expect(joined).not.toContain('event: a');
    expect(joined).toContain('id: 2\nevent: b');
    expect(joined).toContain('id: 3\nevent: c');
  });

  it('无 Last-Event-ID ⇒ 不补发历史（只接收后续实时事件）', async () => {
    broadcastEvent('a', { n: 1 });

    const res = makeRes();
    await handleEvents(makeReq('/'), res);
    expect(res.chunks.join('')).toBe('');

    broadcastEvent('d', { n: 4 });
    expect(res.chunks.join('')).toContain('event: d');
  });

  it('query 参数 lastEventId 与 header 等价', async () => {
    broadcastEvent('a', { n: 1 });
    broadcastEvent('b', { n: 2 });

    const res = makeRes();
    await handleEvents(makeReq('/v1/events?lastEventId=1'), res);
    expect(res.chunks.join('')).toContain('id: 2\nevent: b');
  });
});
