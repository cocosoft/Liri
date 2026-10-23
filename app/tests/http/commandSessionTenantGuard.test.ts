/**
 * 命令入口 × 会话归属的**组合**验证（2026-10-23）
 *
 * 已有两组单测各自成立：
 *  - `commandsExecuteSession.test.ts`：handler 在 `canUseSession() === false` 时回 404；
 *  - `sessionCacheOwnership.test.ts`：`canUseSession()` 对跨身份会话确实回 false。
 * 缺的是**拼起来**：真实 `SessionLifecycleManager` + 真实请求身份作用域 + 命令 handler。
 * 本用例补这条缝（对应 §20.4「越权/跨租户未覆盖」的 HTTP 契约层）。
 */
import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import type http from 'http';

import type { ChatSession } from '../../src/session/types/session';
import { DataSessionStatus } from '@modules/core';
import type { Principal } from '@modules/core/identity/principal';
import { runWithPrincipal } from '@modules/core/identity/requestScope';
import { SessionLifecycleManager } from '../../src/chat/services/SessionLifecycleManager';
import type { SessionGateway } from '../../src/session/SessionGateway';
import type { SessionAccessFacade } from '../../src/chat/services/SessionAccessFacade';
import type { HookChainManager } from '../../src/hooks';
import type { MessageService } from '../../src/chat/services/MessageService';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import { readRequestBody } from '../../src/infrastructure/http/handlers/handler-utils';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

const ALICE_SESSION_ID = 's-alice-1';

function makeAliceSession(): ChatSession {
  return {
    id: ALICE_SESSION_ID,
    title: 'alice 的会话',
    state: DataSessionStatus.ACTIVE,
    metadata: {
      title: 'alice 的会话',
      owner: { tenantId: 'acme', userId: 'alice' },
    },
    messages: [
      {
        id: 'm-1',
        role: 'assistant',
        content: '结论：根因是锁竞争',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
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

const lifecycle = makeLifecycle(makeAliceSession());
const executed: Array<{ command: string; sessionId?: string }> = [];

const coreAPIStub = {
  // 真实归属判定（不是恒定 false 的替身）
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
};

const spy = spyOn(coreAPIModule, 'getCoreAPI').mockReturnValue(
  coreAPIStub as never
);

afterAll(() => {
  spy.mockRestore();
});

const { handleExecuteCommand } =
  await import('../../src/infrastructure/http/handlers/commands-handlers');

function makeReq(body: unknown): http.IncomingMessage {
  const json = JSON.stringify(body);
  return {
    method: 'POST',
    url: '/v1/commands/execute',
    headers: {},
    on(event: string, cb: (arg?: unknown) => void) {
      if (event === 'data') cb(Buffer.from(json));
      if (event === 'end') queueMicrotask(() => cb());
      return this;
    },
  } as unknown as http.IncomingMessage;
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

async function runAs(
  principal: Principal | null,
  command: string
): Promise<{ status: number; body: string }> {
  const { res, status, body } = makeRes();
  const invoke = () =>
    handleExecuteCommand(
      ctx,
      makeReq({ command, session_id: ALICE_SESSION_ID }),
      res
    );
  if (principal) {
    await runWithPrincipal(principal, invoke);
  } else {
    await invoke();
  }
  return { status: status(), body: body() };
}

describe('命令入口 × 会话归属（真实判定 + 真实作用域）', () => {
  test('他人身份读 alice 的会话 ⇒ 404，且**不触达**命令执行器', async () => {
    executed.length = 0;
    const result = await runAs(BOB, 'insights report');

    expect(result.status).toBe(404);
    expect(JSON.parse(result.body).error.type).toBe('not_found_error');
    expect(executed).toEqual([]);
  });

  test('归属者本人 ⇒ 200 且命令拿到该 sessionId', async () => {
    executed.length = 0;
    const result = await runAs(ALICE, 'insights report');

    expect(result.status).toBe(200);
    expect(executed).toEqual([
      { command: 'insights report', sessionId: ALICE_SESSION_ID },
    ]);
  });

  test('本地身份（无请求作用域）⇒ 200（桌面零行为变更）', async () => {
    executed.length = 0;
    const result = await runAs(null, 'insights report');

    expect(result.status).toBe(200);
    expect(executed).toEqual([
      { command: 'insights report', sessionId: ALICE_SESSION_ID },
    ]);
  });
});
