/**
 * BUG-6（2026-10-19）：SSE 心跳必须在「写失败」分支也停表。
 *
 * 回归点：此前只有 `req.on('close')` 会停心跳；半开连接下 close 可能不触发，
 * 写失败移除最后一个客户端后心跳仍每 15s 永久空转。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import type http from 'http';
import {
  getSSEClientCount,
  handleEvents,
  stopSSE,
} from '../../src/infrastructure/http/LocalHTTPServiceSSE';

const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;

afterEach(() => {
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
  stopSSE();
});

describe('SSE 心跳生命周期', () => {
  it('写失败移除最后一个客户端 ⇒ 心跳立即停止（不依赖 req.on(close)）', async () => {
    let heartbeat: (() => void) | null = null;
    const fakeTimer = {
      unref: () => {},
    } as unknown as ReturnType<typeof setInterval>;
    let cleared = 0;

    globalThis.setInterval = ((fn: () => void) => {
      heartbeat = fn;
      return fakeTimer;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = (() => {
      cleared++;
    }) as unknown as typeof clearInterval;

    const closeHandlers: Array<() => void> = [];
    const req = {
      on: (event: string, cb: () => void) => {
        if (event === 'close') closeHandlers.push(cb);
      },
    };
    const res = {
      writeHead: () => {},
      flushHeaders: () => {},
      write: () => {
        throw new Error('socket closed');
      },
      end: () => {},
    };

    await handleEvents(
      req as unknown as http.IncomingMessage,
      res as unknown as http.ServerResponse
    );
    expect(getSSEClientCount()).toBe(1);
    expect(heartbeat).not.toBeNull();

    // 触发一次心跳：write 抛错 ⇒ 移除客户端 ⇒ 必须 clearInterval
    heartbeat!();
    expect(getSSEClientCount()).toBe(0);
    expect(cleared).toBe(1);
    // 全程未触发 close（模拟半开连接）
    expect(closeHandlers.length).toBe(1);
  });
});
