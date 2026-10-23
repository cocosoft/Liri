/**
 * 命令入口 × 会话归属：**真实 token 链路**（2026-10-23）
 *
 * 补 §39.4 的第一条缺口：上一份组合用例用 `runWithPrincipal` 直接建作用域，
 * 没有走「注册 → token → Bearer → withRequestIdentity」这条真实认证链路。
 *
 * 本用例：两个租户用户各自注册拿 token，会话归属 alice；
 * 用 bob 的 Bearer 打 `POST /v1/commands/execute` ⇒ 404 且命令不执行；
 * 用 alice 自己的 token ⇒ 200。
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import type http from 'http';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { AuthUserStore } from '../../src/infrastructure/http/auth/AuthUserStore.js';
import {
  __setAuthUserStoreForTest,
  authTokens,
  handleAuthRegister,
} from '../../src/infrastructure/http/handlers/auth-handlers.js';
import { withRequestIdentity } from '../../src/infrastructure/http/requestIdentity.js';
import { PermissionManager } from '@modules/permission';

import type { ChatSession } from '../../src/session/types/session';
import { DataSessionStatus } from '@openliri/kernel';
import { SessionLifecycleManager } from '../../src/chat/services/SessionLifecycleManager';
import type { SessionGateway } from '../../src/session/SessionGateway';
import type { SessionAccessFacade } from '../../src/chat/services/SessionAccessFacade';
import type { HookChainManager } from '../../src/hooks';
import type { MessageService } from '../../src/chat/services/MessageService';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import { readRequestBody } from '../../src/infrastructure/http/handlers/handler-utils';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';

const SESSION_ID = 's-alice-token-1';
const tokens: string[] = [];
let root: string;

function makeSession(): ChatSession {
  return {
    id: SESSION_ID,
    title: 'alice 的会话',
    state: DataSessionStatus.ACTIVE,
    metadata: {
      title: 'alice 的会话',
      owner: { tenantId: 'acme', userId: 'alice' },
    },
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ChatSession;
}

function makeLifecycle(session: ChatSession): SessionLifecycleManager {
  return new SessionLifecycleManager({
    chatSessions: new Map([[session.id, session]]),
    currentSessionIdRef: { get: () => null, set: () => {} },
    sessionLeaveTimes: new Map(),
    sessionMutexes: new Map(),
    sessionAbortControllers: new Map(),
    sessionGateway: {} as unknown as SessionGateway,
    sessionAccess: {} as unknown as SessionAccessFacade,
    hookChainManager: {} as unknown as HookChainManager,
    messageService: {} as unknown as MessageService,
  });
}

const lifecycle = makeLifecycle(makeSession());
const executed: Array<{ command: string; sessionId?: string }> = [];

const spy = spyOn(coreAPIModule, 'getCoreAPI').mockReturnValue({
  chatManager: {
    canUseSession: (sessionId: string) => lifecycle.canUseSession(sessionId),
  },
  getCommandsOpsPort: async () => ({
    listCommands: async () => [],
    executeCommand: async (command: string, sessionId?: string) => {
      executed.push({ command, sessionId });
      return { success: true, type: 'text', message: 'ok' };
    },
  }),
} as never);

const { handleExecuteCommand } =
  await import('../../src/infrastructure/http/handlers/commands-handlers');

/** 伪请求：既可被 `readRequestBody` 读取，也带 Authorization 头 */
function makeReq(token?: string): http.IncomingMessage {
  const buf = Buffer.from(
    JSON.stringify({
      command: 'insights report',
      session_id: SESSION_ID,
    })
  );
  const stream = Readable.from([buf]);
  const headers: Record<string, string> = {
    'content-length': String(buf.length),
  };
  if (token) headers['authorization'] = `Bearer ${token}`;
  return Object.assign(stream, {
    method: 'POST',
    url: '/v1/commands/execute',
    headers,
  }) as unknown as http.IncomingMessage;
}

function makeRes(): {
  res: http.ServerResponse;
  status: () => number;
  body: () => string;
} {
  const out = { status: 0, body: '' };
  const res = {
    writeHead: (code: number) => {
      out.status = code;
      return res;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
    on: () => undefined,
    write: () => true,
    socket: null,
    headersSent: false,
  } as unknown as http.ServerResponse;
  return { res, status: () => out.status, body: () => out.body };
}

const ctx = {
  readRequestBody,
  broadcastEvent: () => {},
} as unknown as HandlerCtx;

async function registerUser(
  username: string,
  tenantId: string
): Promise<string> {
  const buf = Buffer.from(
    JSON.stringify({ username, password: 'pw', tenantId })
  );
  const req = Object.assign(Readable.from([buf]), {
    method: 'POST',
    headers: { 'content-length': String(buf.length) },
  }) as unknown as http.IncomingMessage;

  const out = { status: 0, body: '' };
  const res = {
    writeHead: (code: number) => {
      out.status = code;
      return res;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
  } as unknown as http.ServerResponse;

  await handleAuthRegister(req, res);
  const token = String(JSON.parse(out.body).token ?? '');
  tokens.push(token);
  return token;
}

async function callAs(
  token: string | undefined
): Promise<{ status: number; body: string }> {
  executed.length = 0;
  const req = makeReq(token);
  const { res, status, body } = makeRes();
  // 无 token 时也要走一次身份解析（本地身份）
  await withRequestIdentity(req, () => handleExecuteCommand(ctx, req, res));
  return { status: status(), body: body() };
}

let aliceToken = '';
let bobToken = '';

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'liri-cmd-token-'));
  __setAuthUserStoreForTest(new AuthUserStore(join(root, 'users.json')));
  process.env['LIRI_TENANT_SELF_REGISTER'] = '1';

  aliceToken = await registerUser('alice', 'acme');
  bobToken = await registerUser('bob', 'acme');
});

afterEach(() => {
  PermissionManager.getInstance().setCurrentUserRole(null);
});

afterAll(() => {
  spy.mockRestore();
  for (const token of tokens.splice(0)) authTokens.delete(token);
  delete process.env['LIRI_TENANT_SELF_REGISTER'];
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // @ignore-catch — Windows 句柄可能延迟释放，清理失败不影响断言
  }
});

describe('命令入口 × 会话归属（真实 token 链路）', () => {
  test('bob 的 Bearer 读 alice 的会话 ⇒ 404 且命令不执行', async () => {
    const result = await callAs(bobToken);

    expect(result.status).toBe(404);
    expect(JSON.parse(result.body).error.type).toBe('not_found_error');
    expect(executed).toEqual([]);
  });

  test('alice 自己的 Bearer ⇒ 200 且拿到 sessionId', async () => {
    const result = await callAs(aliceToken);

    expect(result.status).toBe(200);
    expect(executed).toEqual([
      { command: 'insights report', sessionId: SESSION_ID },
    ]);
  });

  test('无 Bearer ⇒ 本地身份（桌面零行为变更）⇒ 200', async () => {
    const result = await callAs(undefined);

    expect(result.status).toBe(200);
    expect(executed).toEqual([
      { command: 'insights report', sessionId: SESSION_ID },
    ]);
  });
});
