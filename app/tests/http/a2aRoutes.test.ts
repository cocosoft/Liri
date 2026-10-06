/**
 * A2A 对外面守卫（P3-1 / F2 / G2 / G3 + 鉴权，2026-09-29）。
 *
 * 锁十条：
 *   ① **默认关闭** —— 未设 `A2A_ENABLED` ⇒ **不处理、不写响应**（上层自然 404，不泄露端点存在性，G4）；
 *   ② **鉴权 fail-closed** —— 启用但 **`A2A_API_KEY` 未配置** ⇒ **401**（**不**沿用"本地信任基线"放行）；
 *      配置了但头缺失/错 ⇒ **401**；`x-api-key` 正确 ⇒ 放行；
 *   ③ Card：`200`，`capabilities.streaming` / `pushNotifications` **如实为 `false`**（G2）；
 *   ④ `baseUrl`：优先 `A2A_PUBLIC_URL`；缺省按请求 Host 推导（**不硬编码**）；
 *   ⑤ Card：`If-None-Match` 命中 ⇒ **304**；非 GET ⇒ **405**；
 *   ⑥ 委派：**未装配后端 ⇒ 503 + `Retry-After`**（如实，**不伪造**成功；A12：原 501 ⇒ 503）；
 *   ⑦ 委派：`message` 缺失 / 非法 JSON ⇒ **400**；
 *   ⑧ 委派：阈值内完成 ⇒ **200 + `completed`**（含产物）；
 *   ⑨ 委派：超有界等待 ⇒ **202 + `working`**（**不做 HTTP 长挂**，G3），随后回查 ⇒ `completed`；
 *   ⑩ 未知 taskId ⇒ **404**；非 A2A 路径 ⇒ 不处理。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Readable } from 'node:stream';
import type http from 'http';
import {
  dispatchA2ARoutes,
  hasA2ADelegator,
  isA2AEnabled,
  setA2ADelegator,
} from '../../src/infrastructure/http/handlers/routes/a2a-routes';
import { createHandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import { a2aTaskStore } from '../../src/agent/a2a/taskStore';

interface Captured {
  status?: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
}

const CARD_PATH = '/.well-known/agent.json';
const TASKS_PATH = '/v1/a2a/tasks';
const API_KEY = 'test-a2a-key';
const noop = (): void => undefined;

function makeReq(
  method: string,
  headers: Record<string, string> = {},
  body?: string
): http.IncomingMessage {
  const stream = Readable.from(
    body === undefined ? [] : [Buffer.from(body, 'utf-8')]
  );
  return Object.assign(stream, {
    method,
    headers,
  }) as unknown as http.IncomingMessage;
}

function makeRes(): { res: http.ServerResponse; cap: Captured } {
  const cap: Captured = { headers: {}, body: '', ended: false };
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      cap.status = status;
      if (headers) Object.assign(cap.headers, headers);
      return res;
    },
    setHeader(name: string, value: string) {
      cap.headers[name] = value;
    },
    end(chunk?: string) {
      if (typeof chunk === 'string') cap.body += chunk;
      cap.ended = true;
    },
  } as unknown as http.ServerResponse;
  return { res, cap };
}

/** 已授权的请求头（默认带正确密钥） */
function auth(extra: Record<string, string> = {}): Record<string, string> {
  return { 'x-api-key': API_KEY, ...extra };
}

async function call(
  method = 'GET',
  headers: Record<string, string> = {},
  url = CARD_PATH,
  body?: string
): Promise<{ handled: boolean; cap: Captured }> {
  const { res, cap } = makeRes();
  const handled = await dispatchA2ARoutes(
    makeReq(method, headers, body),
    res,
    url,
    noop,
    createHandlerCtx()
  );
  return { handled, cap };
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 开启 A2A 且配置密钥（多数用例的前置） */
function enableA2A(): void {
  process.env.A2A_ENABLED = 'true';
  process.env.A2A_API_KEY = API_KEY;
}

beforeEach(() => {
  a2aTaskStore.clear();
  setA2ADelegator(null);
});

afterEach(() => {
  delete process.env.A2A_ENABLED;
  delete process.env.A2A_API_KEY;
  delete process.env.A2A_PUBLIC_URL;
  delete process.env.A2A_DELEGATE_MAX_WAIT_MS;
  setA2ADelegator(null);
  a2aTaskStore.clear();
});

describe('A2A 鉴权（专用密钥 + fail-closed）', () => {
  it('② 启用但 A2A_API_KEY 未配置 ⇒ 401（不回退"本地信任基线"）', async () => {
    process.env.A2A_ENABLED = 'true'; // 只启用、**不**配密钥
    const { handled, cap } = await call();
    expect(handled).toBe(true);
    expect(cap.status).toBe(401);
  });

  it('② 密钥已配置但请求头缺失/错误 ⇒ 401；正确 ⇒ 放行', async () => {
    enableA2A();

    expect((await call()).cap.status).toBe(401); // 无头
    expect((await call('GET', { 'x-api-key': 'wrong' })).cap.status).toBe(401);
    expect((await call('GET', auth({ host: 'h.test' }))).cap.status).toBe(200);
  });
});

describe('A2A Agent Card（发现）', () => {
  it('① 默认关闭：未设 A2A_ENABLED ⇒ 不处理、不写响应（鉴权之前）', async () => {
    expect(isA2AEnabled()).toBe(false);
    const { handled, cap } = await call();
    expect(handled).toBe(false);
    expect(cap.ended).toBe(false);
    expect(cap.status).toBeUndefined();
  });

  it('③ 启用 ⇒ 200，capabilities 如实为 false（G2）', async () => {
    enableA2A();
    const { handled, cap } = await call(
      'GET',
      auth({ host: 'example.test:18990' })
    );
    expect(handled).toBe(true);
    expect(cap.status).toBe(200);

    const card = JSON.parse(cap.body) as {
      protocolVersion: string;
      url: string;
      capabilities: { streaming: boolean; pushNotifications: boolean };
    };
    expect(card.protocolVersion).toBe('1.0');
    expect(card.url).toBe('http://example.test:18990');
    expect(card.capabilities).toEqual({
      streaming: false,
      pushNotifications: false,
    });
  });

  it('④ A2A_PUBLIC_URL 优先于请求 Host', async () => {
    enableA2A();
    process.env.A2A_PUBLIC_URL = 'https://agents.example.com';
    const { cap } = await call('GET', auth({ host: 'internal.test' }));
    expect((JSON.parse(cap.body) as { url: string }).url).toBe(
      'https://agents.example.com'
    );
  });

  it('⑤ If-None-Match 命中 ⇒ 304；非 GET ⇒ 405', async () => {
    enableA2A();
    const first = await call('GET', auth({ host: 'h.test' }));
    const etag = first.cap.headers['ETag'];
    expect(typeof etag).toBe('string');

    const second = await call(
      'GET',
      auth({ host: 'h.test', 'if-none-match': etag })
    );
    expect(second.cap.status).toBe(304);
    expect(second.cap.body).toBe('');

    expect((await call('POST', auth())).cap.status).toBe(405);
  });
});

describe('A2A 委派（T4）', () => {
  it('⑥ 未装配委派后端 ⇒ 503 + Retry-After（如实，不建任务）', async () => {
    enableA2A();
    expect(hasA2ADelegator()).toBe(false);
    const { handled, cap } = await call(
      'POST',
      auth(),
      TASKS_PATH,
      JSON.stringify({ message: 'ping' })
    );
    expect(handled).toBe(true);
    // A12（2026-10-06）：501（"永不支持"）→ 503（"暂不可用"，装配后恢复）+ Retry-After
    expect(cap.status).toBe(503);
    expect(cap.headers['Retry-After']).toBe('5');
    expect(a2aTaskStore.list()).toHaveLength(0);
  });

  it('⑦ message 缺失 / 非法 JSON ⇒ 400', async () => {
    enableA2A();
    setA2ADelegator(async () => 'ok');
    expect(
      (await call('POST', auth(), TASKS_PATH, JSON.stringify({}))).cap.status
    ).toBe(400);
    expect(
      (await call('POST', auth(), TASKS_PATH, 'not-json')).cap.status
    ).toBe(400);
  });

  it('⑧ 阈值内完成 ⇒ 200 + completed（含产物）', async () => {
    enableA2A();
    setA2ADelegator(async (message, agentId) => `${agentId}:${message}`);

    const { handled, cap } = await call(
      'POST',
      auth(),
      TASKS_PATH,
      JSON.stringify({ message: 'ping', agentId: 'a1' })
    );
    expect(handled).toBe(true);
    expect(cap.status).toBe(200);

    const task = JSON.parse(cap.body) as {
      status: { state: string };
      artifacts: { parts: { text?: string }[] }[];
    };
    expect(task.status.state).toBe('completed');
    expect(task.artifacts[0]?.parts[0]?.text).toBe('a1:ping');
  });

  it('⑨ 超有界等待 ⇒ 202 + working；随后回查 ⇒ completed（G3）', async () => {
    enableA2A();
    process.env.A2A_DELEGATE_MAX_WAIT_MS = '1';
    setA2ADelegator(async () => {
      await delay(20);
      return 'late-reply';
    });

    const started = await call(
      'POST',
      auth(),
      TASKS_PATH,
      JSON.stringify({ message: 'slow' })
    );
    expect(started.cap.status).toBe(202);
    const created = JSON.parse(started.cap.body) as {
      id: string;
      status: { state: string };
    };
    expect(created.status.state).toBe('working');

    await delay(80);
    const polled = await call('GET', auth(), `${TASKS_PATH}/${created.id}`);
    expect(polled.cap.status).toBe(200);
    const task = JSON.parse(polled.cap.body) as {
      status: { state: string };
      artifacts: { parts: { text?: string }[] }[];
    };
    expect(task.status.state).toBe('completed');
    expect(task.artifacts[0]?.parts[0]?.text).toBe('late-reply');
  });

  it('⑩ 未知 taskId ⇒ 404；非 A2A 路径 ⇒ 不处理', async () => {
    enableA2A();
    expect((await call('GET', auth(), `${TASKS_PATH}/nope`)).cap.status).toBe(
      404
    );
    expect((await call('GET', auth(), '/v1/goals')).handled).toBe(false);
  });
});
