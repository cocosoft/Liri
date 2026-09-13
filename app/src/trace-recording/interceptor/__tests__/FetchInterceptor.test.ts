/**
 * FetchInterceptor 单元测试
 *
 * 覆盖 v5 方案 3.2：
 * - 流式请求：先 emitRecord(pending)，后 emitRecord(completed)，共享同一 reqId
 * - 非流式请求：单写（无 pending）
 * - buildRecord 的 phase/completedAt 语义
 * - 读流抛错：streamError 保存并写入 completed 的 error 字段
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { FetchInterceptor } from '../FetchInterceptor';
import type { TraceRecord, TraceConfig } from '../../types';

/** 假引擎：仅实现 intercept 用到的方法 */
function makeFakeEngine() {
  return {
    getMode: () => 'all' as TraceConfig['mode'],
    getSlowThreshold: () => 30000,
    record: async () => {},
  };
}

function makeSSEBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

/** 返回可被 intercept 读取的 SSE 响应 */
function makeSSEResponse(): Response {
  return new Response(makeSSEBody(['data: {"content":"hi"}\n\n']), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

let interceptor: FetchInterceptor;
let records: TraceRecord[];
/** 保存原始全局 fetch，测试后恢复 */
let originalGlobalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalGlobalFetch = globalThis.fetch;
  interceptor = new FetchInterceptor();
  records = [];
  // 先替换全局 fetch 为 mock，再 install——install 会捕获该 mock 作为 original，
  // 从而 intercept 的 `await original()` 走 mock，不触真实网络。
  globalThis.fetch = (() => makeSSEResponse()) as typeof fetch;
  interceptor.install(makeFakeEngine() as never, (rec) => {
    records.push(rec);
  });
});

afterEach(() => {
  interceptor.uninstall();
  globalThis.fetch = originalGlobalFetch;
});

describe('FetchInterceptor 两阶段写入（v5 方案 3.2）', () => {
  test('流式请求：pending 先行、completed 后行，共享 reqId', async () => {
    const body = JSON.stringify({
      model: 'test-model',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });

    const resp = await fetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(resp.status).toBe(200);
    // 等待 SSE 读流完成 + 异步 emit 落盘
    await new Promise((r) => setTimeout(r, 20));

    const pending = records.find((r) => r.phase === 'pending');
    const completed = records.find((r) => r.phase === 'completed');
    expect(pending).toBeDefined();
    expect(completed).toBeDefined();
    expect(pending!.id).toBe(completed!.id); // 共享 reqId
    expect(pending!.durationMs).toBe(0);
    expect(pending!.response.status).toBe(0);
    expect(completed!.durationMs).toBeGreaterThanOrEqual(0);
    expect(completed!.response.status).toBe(200);
  });

  test('非流式请求：单写（无 pending）', async () => {
    // 请求体无 stream → isStreaming=false → 不写 pending
    const body = JSON.stringify({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
    });

    await fetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(records.some((r) => r.phase === 'pending')).toBe(false);
    expect(records.length).toBeGreaterThanOrEqual(1);
  });
});

describe('FetchInterceptor buildRecord phase/completedAt（v5 方案 3.1）', () => {
  test('completed 记录带 completedAt，pending 不带', async () => {
    const body = JSON.stringify({
      model: 'test-model',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
    await fetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    await new Promise((r) => setTimeout(r, 20));

    const pending = records.find((r) => r.phase === 'pending');
    const completed = records.find((r) => r.phase === 'completed');
    expect(completed!.completedAt).toBeDefined();
    expect(pending!.completedAt).toBeUndefined();
    expect(completed!.timestamp).toBe(pending!.timestamp); // 均为发起时刻
  });
});

describe('FetchInterceptor 读流错误处理（v5 方案 3.2 streamError）', () => {
  test('读流抛错 → completed 带 error 字段', async () => {
    // 构造读流中途抛错的响应体：pull 抛错
    const failingBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"content":"partial"}\n\n')
        );
      },
      pull() {
        throw new Error('stream interrupted');
      },
    });
    const failingResp = new Response(failingBody, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });

    // 替换全局 fetch 返回抛错响应，重新安装
    interceptor.uninstall();
    records = [];
    globalThis.fetch = (() => failingResp) as typeof fetch;
    interceptor.install(makeFakeEngine() as never, (rec) => {
      records.push(rec);
    });

    const body = JSON.stringify({
      model: 'test-model',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
    await fetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    await new Promise((r) => setTimeout(r, 20));

    const completed = records.find((r) => r.phase === 'completed');
    expect(completed).toBeDefined();
    // 读流 catch 保存的 streamError 应写入 completed.error
    expect(completed!.error).toBe('stream interrupted');
  });
});
