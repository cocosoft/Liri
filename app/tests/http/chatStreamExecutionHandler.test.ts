// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * P0-3 / `INV-EXEC-006` —— 客户端流式入口的 **handler 级** Execution 契约
 * （B2，2026-10-10；来源 `.trae/specs/boundary-convergence-plan.md §2-P0-3`）
 *
 * 背景：`.trae/specs/client-stream-execution.md §5.1` 如实登记 ——
 * `POST /v1/chat/completions`（`stream=true` ⇒ `handleStreamingChat`）的 handler 级行为
 * （acquire 注入 / 终态结算 / 断开结算）**无自动化用例**，这是 `INV-EXEC-006`
 * 停在 `partial` 的唯一原因，也是**翻转 `CLIENT_STREAM_EXECUTION` 默认值的前置条件**。
 *
 * 本文件锁三条断言：
 *  ① **记账**     —— 开关开 ⇒ `acquire(sessionId, messageId)`，且**流启动时**该 session
 *                   已有 `RUNNING` 执行记录、`ChatRequest.executionId` 非空
 *                   （= 与渠道路径同一记账链路的注入口径）；
 *  ② **终态结算** —— 正常完成 ⇒ `complete(executionId)` 恰一次 + 释放所有权（无残留）；
 *  ③ **断开结算** —— 客户端断开 ⇒ `fail(executionId, 'client_disconnected')`（`complete` 零次）。
 * 另加一条守卫：**开关关（默认）⇒ 不 acquire / 不注入 / 不结算**（零行为变更，spec §4①）。
 *
 * 口径说明：「工具执行**前**的 `tool_calls` 写前记账 + fail-closed」由**执行者侧**用例覆盖
 * （`tests/chat/chatManagerToolLedgerFailClosed.test.ts`，`INV-RECOVERY-002`）；
 * 本入口的职责即**把 `executionId` 传进去**，故此处只断言注入，不重复断言执行者内部行为。
 *
 * 手法：`spyOn(module, 'getCoreAPI')` + **动态导入**被测 handler（静态 import 会被 ESM 提升，
 * 早于 spy 生效），与 `tests/http/auto-reply-handlers.test.ts` 同款；`res` 为最小 mock
 * （不开真实 socket），`getExecutionManager()` 用**真单例**（`spyOn` 调用穿透 + 记录调用）。
 * 注意：`mockRestore()` 会清空已记录的调用 ⇒ 断言必须在 `afterEach` 统一还原**之前**执行。
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
} from 'bun:test';
import type http from 'http';
import * as coreAPIModule from '../../src/runtime/api/CoreAPIImpl';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import type {
  ChatRequest,
  ChatStreamChunk,
} from '../../src/runtime/api/CoreAPI';
import { getExecutionManager } from '../../src/execution/index.js';

const ENV_FLAG = 'FEATURE_CLIENT_STREAM_EXECUTION';

const SESSION_ID = 's1';
const MESSAGE_ID = 'm1';

/** 上一次 `chatStream` 收到的请求（供断言注入的 `executionId`） */
let capturedRequest: ChatRequest | undefined;
/** 流**启动时**（首次 `next()`）该 session 的执行记录快照 */
let recordAtStreamStart: { executionId?: string; status?: string } = {};
/** 本次 `chatStream` 的产出（各用例按需替换） */
let chatStreamImpl: (
  req: ChatRequest
) => AsyncGenerator<ChatStreamChunk, unknown, unknown>;

/** 事件总线 stub（handler 只 `on`/`off`，本用例不驱动工具事件） */
const eventBusStub = { on: () => {}, off: () => {} };
const chatManagerStub = {
  getEventNotificationService: () => eventBusStub,
  isSessionStreaming: () => false,
  abortSessionStream: () => {},
};

const coreAPIStub = {
  chatManager: chatManagerStub,
  getChatManager: () => chatManagerStub,
  chat: async () => ({ content: '' }),
  // 包装一层：每个用例替换 `chatStreamImpl` 即可切换流行为
  chatStream: (req: ChatRequest) => chatStreamImpl(req),
};

// 先 spy（模块级），再动态导入 handler ⇒ handler 内 `getCoreAPI()` 命中本桩
const getCoreAPISpy = spyOn(coreAPIModule, 'getCoreAPI').mockReturnValue(
  coreAPIStub as never
);

afterAll(() => {
  getCoreAPISpy.mockRestore();
});

const { handleChatCompletions } =
  await import('../../src/infrastructure/http/handlers/chat-handlers');

/** 默认流：1 个 text chunk 后正常结束 */
function defaultStream(req: ChatRequest) {
  return (async function* () {
    capturedRequest = req;
    const rec = req.sessionId
      ? getExecutionManager().getBySession(req.sessionId)
      : undefined;
    recordAtStreamStart = {
      executionId: rec?.executionId,
      status: rec?.status,
    };
    yield {
      type: 'text',
      content: 'hi',
      sessionId: SESSION_ID,
    } as unknown as ChatStreamChunk;
    return { content: 'hi', finishReason: 'stop' };
  })();
}

interface ResHarness {
  res: http.ServerResponse;
  /** SSE 写出片段（按 `data: …` 帧顺序） */
  chunks: string[];
  /** 触发 `res.on('close')`（真实 `ServerResponse` 收尾即触发；用于清 SSE 保活定时器） */
  emitClose: () => void;
}

/** 最小 `ServerResponse` mock：不建 socket，仅记录写出与 close 监听 */
function makeRes(opts: { destroyed?: boolean } = {}): ResHarness {
  const chunks: string[] = [];
  const closeHandlers: Array<() => void> = [];
  const res = {
    headersSent: false,
    destroyed: opts.destroyed ?? false,
    writableEnded: false,
    socket: undefined,
    flush: () => {},
    writeHead: () => res,
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    end: (chunk?: string) => {
      if (chunk) chunks.push(chunk);
      res.writableEnded = true;
      return res;
    },
    on: (event: string, cb: () => void) => {
      if (event === 'close') closeHandlers.push(cb);
      return res;
    },
  };
  return {
    res: res as unknown as http.ServerResponse,
    chunks,
    emitClose: () => {
      for (const h of closeHandlers) h();
    },
  };
}

function makeCtx(body: Record<string, unknown>): HandlerCtx {
  return {
    readRequestBody: async () => JSON.stringify(body),
    sendError: () => {},
  } as unknown as HandlerCtx;
}

const body = {
  messages: [{ role: 'user', content: 'hi' }],
  stream: true,
  session_id: SESSION_ID,
  message_id: MESSAGE_ID,
};

/** 本用例内创建的 spy（统一在 `afterEach` 还原 ⇒ 断言期间调用记录仍在） */
const spies: Array<{ mockRestore: () => void }> = [];

function track<T extends { mockRestore: () => void }>(spy: T): T {
  spies.push(spy);
  return spy;
}

let prevFlag: string | undefined;

beforeEach(() => {
  capturedRequest = undefined;
  recordAtStreamStart = {};
  chatStreamImpl = defaultStream;
  prevFlag = process.env[ENV_FLAG];
  getExecutionManager().reset();
});

afterEach(() => {
  for (const s of spies.splice(0, spies.length)) s.mockRestore();
  if (prevFlag === undefined) delete process.env[ENV_FLAG];
  else process.env[ENV_FLAG] = prevFlag;
  prevFlag = undefined;
  getExecutionManager().reset();
});

/** 驱动一次 `handleChatCompletions`（stream=true），并在收尾后触发 `close`（清保活定时器） */
async function run(opts: { destroyed?: boolean } = {}): Promise<ResHarness> {
  const harness = makeRes(opts);
  try {
    await handleChatCompletions(
      makeCtx(body),
      {} as http.IncomingMessage,
      harness.res
    );
  } finally {
    harness.emitClose();
  }
  return harness;
}

describe('客户端流式入口 Execution 契约（P0-3 / INV-EXEC-006）', () => {
  it('① 记账：开关开 ⇒ acquire(sessionId, messageId) 且流启动时已有 RUNNING 记录 + 注入 executionId', async () => {
    process.env[ENV_FLAG] = 'true';
    const mgr = getExecutionManager();
    const acquireSpy = track(spyOn(mgr, 'acquire'));

    await run();

    // 注入：与渠道路径同一记账链路（ChatManager 据此 `beginToolCall` 写前记账 + fail-closed）
    expect(capturedRequest?.executionId).toBeDefined();
    // 流**启动时**该 session 已有执行记录且处于 RUNNING（记账先于生成）
    expect(recordAtStreamStart.executionId).toBe(capturedRequest?.executionId);
    expect(recordAtStreamStart.status).toBe('RUNNING');

    expect(acquireSpy).toHaveBeenCalledTimes(1);
    expect(acquireSpy.mock.calls[0]).toEqual([SESSION_ID, MESSAGE_ID]);
  });

  it('② 终态结算：正常完成 ⇒ complete(executionId) 恰一次 + 所有权释放（无残留）', async () => {
    process.env[ENV_FLAG] = 'true';
    const mgr = getExecutionManager();
    const completeSpy = track(spyOn(mgr, 'complete'));
    const failSpy = track(spyOn(mgr, 'fail'));

    const harness = await run();

    expect(completeSpy).toHaveBeenCalledTimes(1);
    expect(failSpy).toHaveBeenCalledTimes(0);
    expect(String(completeSpy.mock.calls[0][0])).toBe(
      capturedRequest?.executionId
    );
    // 结算 + `release()` ⇒ 记录清空、所有权归还（不会把 session 锁死）
    expect(mgr.getBySession(SESSION_ID)).toBeUndefined();
    // 终态正常收尾仍按 SSE 协议关闭
    expect(harness.chunks.at(-1)).toContain('[DONE]');
  });

  it("③ 断开结算：客户端断开 ⇒ fail(executionId, 'client_disconnected') 且 complete 零次", async () => {
    process.env[ENV_FLAG] = 'true';
    const mgr = getExecutionManager();
    const completeSpy = track(spyOn(mgr, 'complete'));
    const failSpy = track(spyOn(mgr, 'fail'));

    // 客户端已断开（流内即判定）⇒ 走早退分支
    const harness = await run({ destroyed: true });

    expect(failSpy).toHaveBeenCalledTimes(1);
    expect(String(failSpy.mock.calls[0][0])).toBe(capturedRequest?.executionId);
    expect(String(failSpy.mock.calls[0][1])).toBe('client_disconnected');
    expect(completeSpy).toHaveBeenCalledTimes(0);
    // 断开 ⇒ 不写 `[DONE]`
    expect(harness.chunks.join('')).not.toContain('[DONE]');
  });

  it('守卫：开关关（默认）⇒ 不 acquire / 不注入 / 不结算（零行为变更）', async () => {
    delete process.env[ENV_FLAG];
    const mgr = getExecutionManager();
    const acquireSpy = track(spyOn(mgr, 'acquire'));
    const completeSpy = track(spyOn(mgr, 'complete'));
    const failSpy = track(spyOn(mgr, 'fail'));

    const harness = await run();

    expect(acquireSpy).toHaveBeenCalledTimes(0);
    expect(completeSpy).toHaveBeenCalledTimes(0);
    expect(failSpy).toHaveBeenCalledTimes(0);
    expect(capturedRequest?.executionId).toBeUndefined();
    expect(recordAtStreamStart.executionId).toBeUndefined();
    // 流仍按既有行为正常输出
    expect(harness.chunks.at(-1)).toContain('[DONE]');
  });
});
