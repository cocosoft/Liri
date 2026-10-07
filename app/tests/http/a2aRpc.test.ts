/**
 * A2A v1.0 JSON-RPC 绑定（T4 批次 B）—— `POST /v1/a2a/rpc`
 *
 * Spec：`.trae/specs/a2a-jsonrpc-binding.md`（§2 权威要点 / §3 能力门控 / §7 验收）
 *
 * 锁十项：
 *   ① 非 POST ⇒ **405**（HTTP 层）；未启用/未鉴权沿用既有双闸（不在本文件重复）；
 *   ② `A2A-Version` 缺失或 ≠ `1.0` ⇒ `-32009 VersionNotSupported`（spec §3.6.1：缺失按 0.3）；
 *   ③ 非法 JSON ⇒ `-32700`；非对象 / 缺 `jsonrpc`/`method` ⇒ `-32600`；
 *   ④ 未知方法 ⇒ `-32601`；**v0.3 别名可用**（`tasks/get` → `GetTask`）；
 *   ⑤ 能力门控（spec §3.3.4）：4 个 push 配置 ⇒ **`-32003`**；2 个流操作 ⇒ **`-32004`**；扩展卡 ⇒ **`-32004`**；
 *   ⑥ `GetTask`：未知 id ⇒ `-32001`；`historyLength:0` ⇒ **省略 `history`**；
 *   ⑦ `SendMessage`：未装配后端 ⇒ `-32603`（如实，不伪造）；缺 message / 无 text part ⇒ `-32602`；
 *      正常 ⇒ `result.task` 为 `TASK_STATE_COMPLETED`；`returnImmediately:true` ⇒ 立即 `TASK_STATE_WORKING`；
 *   ⑧ `CancelTask`：未知 ⇒ `-32001`；已终态 ⇒ `-32002`；`submitted` ⇒ 成功转 `TASK_STATE_CANCELED`；
 *   ⑨ `ListTasks`：**status timestamp 降序** / 默认 `pageSize=50` / 无更多结果 ⇒ `nextPageToken === ''` /
 *      `includeArtifacts` 非 true ⇒ **无 `artifacts` 键**；
 *   ⑩ 协议级错误以 **HTTP 200 + `error` 对象**返回（JSON-RPC 惯例；见 spec §9-1 登记）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Readable } from 'node:stream';
import type http from 'http';
import {
  dispatchA2ARoutes,
  setA2ADelegator,
} from '../../src/infrastructure/http/handlers/routes/a2a-routes';
import { createHandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import { a2aTaskStore } from '../../src/agent/a2a/taskStore';

const RPC_PATH = '/v1/a2a/rpc';
const API_KEY = 'test-a2a-key';
const noop = (): void => undefined;
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface Captured {
  status?: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
}

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

/** 发起一次 RPC 调用（默认带正确密钥 + `A2A-Version: 1.0`） */
async function callRpc(
  payload: string,
  opts: {
    method?: string;
    version?: string | null;
    apiKey?: string | null;
  } = {}
): Promise<{ handled: boolean; cap: Captured }> {
  const headers: Record<string, string> = {};
  if (opts.apiKey !== null) headers['x-api-key'] = opts.apiKey ?? API_KEY;
  if (opts.version !== null) headers['a2a-version'] = opts.version ?? '1.0';
  const { res, cap } = makeRes();
  const handled = await dispatchA2ARoutes(
    makeReq(opts.method ?? 'POST', headers, payload),
    res,
    RPC_PATH,
    noop,
    createHandlerCtx()
  );
  return { handled, cap };
}

/** 构造 JSON-RPC 信封（默认 `id: 1`，`A2A-Version` 默认合法） */
function envelope(method: string, params?: unknown, id: unknown = 1): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

/** 断言 `error.code` 并返回整个响应对象 */
async function expectErrorCode(
  payload: string,
  code: number,
  opts?: Parameters<typeof callRpc>[1]
): Promise<Record<string, unknown>> {
  const { handled, cap } = await callRpc(payload, opts);
  expect(handled).toBe(true);
  expect(cap.status).toBe(200); // ⑩ JSON-RPC 惯例：协议级错误仍是 HTTP 200
  const body = JSON.parse(cap.body) as {
    error?: { code?: number };
    result?: unknown;
  };
  expect(body.error?.code).toBe(code);
  expect('result' in body).toBe(false);
  return body as Record<string, unknown>;
}

function enableA2A(): void {
  process.env.A2A_ENABLED = 'true';
  process.env.A2A_API_KEYS = API_KEY;
}

beforeEach(() => {
  a2aTaskStore.clear();
  setA2ADelegator(null);
});

afterEach(() => {
  delete process.env.A2A_ENABLED;
  delete process.env.A2A_API_KEYS;
  setA2ADelegator(null);
  a2aTaskStore.clear();
});

describe('A2A JSON-RPC：信封与版本', () => {
  it('① 非 POST ⇒ 405（HTTP 层，不入 JSON-RPC）', async () => {
    enableA2A();
    const { handled, cap } = await callRpc(envelope('GetTask'), {
      method: 'GET',
    });
    expect(handled).toBe(true);
    expect(cap.status).toBe(405);
  });

  it('② A2A-Version 缺失（按 0.3 处理）或 ≠ 1.0 ⇒ -32009', async () => {
    enableA2A();
    await expectErrorCode(envelope('GetTask'), -32009, { version: null });
    await expectErrorCode(envelope('GetTask'), -32009, { version: '0.3' });
  });

  it('③ 非法 JSON ⇒ -32700；非对象 / 缺 jsonrpc / 缺 method ⇒ -32600', async () => {
    enableA2A();
    await expectErrorCode('not-json', -32700);
    await expectErrorCode('[]', -32600);
    await expectErrorCode('"str"', -32600);
    await expectErrorCode(JSON.stringify({ id: 1, method: 'GetTask' }), -32600);
    await expectErrorCode(JSON.stringify({ jsonrpc: '2.0', id: 1 }), -32600);
  });

  it('④ 未知方法 ⇒ -32601；**v0.3 别名**可用（tasks/get → GetTask）', async () => {
    enableA2A();
    await expectErrorCode(envelope('NoSuchMethod'), -32601);

    const task = a2aTaskStore.create();
    const { cap } = await callRpc(envelope('tasks/get', { id: task.id }));
    const body = JSON.parse(cap.body) as { result?: { id?: string } };
    expect(body.result?.id).toBe(task.id);
  });
});

describe('A2A JSON-RPC：能力门控（spec §3.3.4）', () => {
  it('⑤ 4 个 push 配置操作 ⇒ -32003；2 个流操作 ⇒ -32004；扩展卡 ⇒ -32004', async () => {
    enableA2A();
    for (const m of [
      'CreateTaskPushNotificationConfig',
      'GetTaskPushNotificationConfig',
      'ListTaskPushNotificationConfigs',
      'DeleteTaskPushNotificationConfig',
    ]) {
      await expectErrorCode(envelope(m, {}), -32003);
    }
    await expectErrorCode(envelope('SendStreamingMessage', {}), -32004);
    await expectErrorCode(envelope('SubscribeToTask', { id: 'x' }), -32004);
    await expectErrorCode(envelope('GetExtendedAgentCard', {}), -32004);
  });
});

describe('A2A JSON-RPC：GetTask / CancelTask', () => {
  it('⑥ 未知 id ⇒ -32001；historyLength:0 ⇒ **省略 history 键**', async () => {
    enableA2A();
    await expectErrorCode(envelope('GetTask', { id: 'nope' }), -32001);

    const task = a2aTaskStore.create();
    a2aTaskStore.complete(task.id, 'TASK_STATE_COMPLETED', [], {
      messageId: 'm1',
      role: 'agent',
      parts: [{ text: 'hi' }],
    });

    const withHistory = await callRpc(
      envelope('GetTask', { id: task.id, historyLength: 1 })
    );
    const h1 = JSON.parse(withHistory.cap.body) as {
      result?: { history?: unknown[] };
    };
    expect(h1.result?.history).toHaveLength(1);

    const noHistory = await callRpc(
      envelope('GetTask', { id: task.id, historyLength: 0 })
    );
    const h0 = JSON.parse(noHistory.cap.body) as {
      result?: Record<string, unknown>;
    };
    expect(h0.result && 'history' in h0.result).toBe(false);
  });

  it('⑧ CancelTask：未知 ⇒ -32001；已终态 ⇒ -32002；submitted ⇒ CANCELED', async () => {
    enableA2A();
    await expectErrorCode(envelope('CancelTask', { id: 'nope' }), -32001);

    const terminal = a2aTaskStore.create();
    a2aTaskStore.complete(terminal.id, 'TASK_STATE_COMPLETED', []);
    await expectErrorCode(envelope('CancelTask', { id: terminal.id }), -32002);

    const open = a2aTaskStore.create();
    const { cap } = await callRpc(envelope('CancelTask', { id: open.id }));
    const body = JSON.parse(cap.body) as {
      result?: { status?: { state?: string } };
    };
    expect(body.result?.status?.state).toBe('TASK_STATE_CANCELED');
  });
});

describe('A2A JSON-RPC：SendMessage', () => {
  it('⑦ 未装配后端 ⇒ -32603（如实，不伪造）；缺 message / 无 text part ⇒ -32602', async () => {
    enableA2A();
    await expectErrorCode(
      envelope('SendMessage', {
        message: { messageId: 'm', role: 'user', parts: [{ text: 'hi' }] },
      }),
      -32603
    );

    setA2ADelegator(async () => 'ok');
    await expectErrorCode(envelope('SendMessage', {}), -32602);
    await expectErrorCode(
      envelope('SendMessage', {
        message: { messageId: 'm', role: 'user', parts: [] },
      }),
      -32602
    );
  });

  it('⑦ 正常 ⇒ result.task 为 COMPLETED（复用 runDelegation）；returnImmediately ⇒ WORKING', async () => {
    enableA2A();
    setA2ADelegator(async (message) => `echo:${message}`);

    const done = await callRpc(
      envelope('SendMessage', {
        message: { messageId: 'm', role: 'user', parts: [{ text: 'ping' }] },
      })
    );
    const doneBody = JSON.parse(done.cap.body) as {
      result?: {
        task?: {
          status?: { state?: string };
          artifacts?: { parts?: { text?: string }[] }[];
        };
      };
    };
    expect(doneBody.result?.task?.status?.state).toBe('TASK_STATE_COMPLETED');
    expect(doneBody.result?.task?.artifacts?.[0]?.parts?.[0]?.text).toBe(
      'echo:ping'
    );

    // `returnImmediately: true` ⇒ waitMs=0 ⇒ **不阻塞**；用**延迟** delegator 证明此时返回的是
    // `working`（若仍阻塞则会等到 COMPLETED —— 瞬时 delegator 下两者无法区分，故必须延迟）
    setA2ADelegator(async () => {
      await delay(40);
      return 'late';
    });
    const immediate = await callRpc(
      envelope('SendMessage', {
        message: { messageId: 'm2', role: 'user', parts: [{ text: 'async' }] },
        configuration: { returnImmediately: true },
      })
    );
    const immBody = JSON.parse(immediate.cap.body) as {
      result?: { task?: { status?: { state?: string } } };
    };
    expect(immBody.result?.task?.status?.state).toBe('TASK_STATE_WORKING');
    // 等后台收尾落定，避免 `afterEach` 清库后残留 pending 触发一次日志噪音
    await delay(60);
  });
});

describe('A2A JSON-RPC：ListTasks（§3.1.4）', () => {
  it('⑨ 降序 / 默认 pageSize=50 / 空 nextPageToken / includeArtifacts 缺省 ⇒ 无 artifacts 键', async () => {
    enableA2A();
    const first = a2aTaskStore.create();
    const second = a2aTaskStore.create();
    // 让 first 的 status.timestamp 变新（`create` 用 ISO 串 ⇒ 后创建者通常更新；显式设置以保证确定性）
    first.status = {
      state: 'TASK_STATE_SUBMITTED',
      timestamp: '2099-01-01T00:00:00.000Z',
    };
    second.status = {
      state: 'TASK_STATE_SUBMITTED',
      timestamp: '2020-01-01T00:00:00.000Z',
    };

    const { cap } = await callRpc(envelope('ListTasks', {}));
    const body = JSON.parse(cap.body) as {
      result?: {
        tasks?: { id?: string; artifacts?: unknown }[];
        nextPageToken?: string;
        pageSize?: number;
        totalSize?: number;
      };
    };
    expect(body.result?.totalSize).toBe(2);
    expect(body.result?.pageSize).toBe(50);
    expect(body.result?.nextPageToken).toBe('');
    // 降序：timestamp 更新的在前
    expect(body.result?.tasks?.[0]?.id).toBe(first.id);
    // includeArtifacts 缺省（非 true）⇒ 必须**整体省略** artifacts
    expect(body.result?.tasks?.[0] && 'artifacts' in body.result.tasks[0]).toBe(
      false
    );
  });

  it('⑨ 分页：pageSize 夹到 [1,100]；有更多结果 ⇒ nextPageToken 非空且可续页', async () => {
    enableA2A();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const t = a2aTaskStore.create();
      t.status = {
        state: 'TASK_STATE_SUBMITTED',
        timestamp: `2026-01-0${i + 1}T00:00:00.000Z`,
      };
      ids.push(t.id);
    }

    const page1 = await callRpc(envelope('ListTasks', { pageSize: 0 }));
    const p1 = JSON.parse(page1.cap.body) as {
      result?: {
        tasks?: { id?: string }[];
        nextPageToken?: string;
        pageSize?: number;
        totalSize?: number;
      };
    };
    // pageSize=0 ⇒ 夹到下限 1
    expect(p1.result?.pageSize).toBe(1);
    expect(p1.result?.totalSize).toBe(3);
    expect(p1.result?.tasks).toHaveLength(1);
    // 降序：2026-01-03 最新
    expect(p1.result?.tasks?.[0]?.id).toBe(ids[2]);
    expect(p1.result?.nextPageToken).toBe('1');

    const page2 = await callRpc(
      envelope('ListTasks', { pageSize: 1, pageToken: '1' })
    );
    const p2 = JSON.parse(page2.cap.body) as {
      result?: { tasks?: { id?: string }[]; nextPageToken?: string };
    };
    expect(p2.result?.tasks?.[0]?.id).toBe(ids[1]);
    expect(p2.result?.nextPageToken).toBe('2');
  });
});
