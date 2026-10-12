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
 * F2 回归（2026-10-12，任务 `budget-suspend-resume` Task 3）：TAOR 循环注册表接线 +「真再跑」。
 *
 * 修复前的缺陷（实证）：
 *  - `registerTAORLoop`（`infrastructure/http/handlers/checkpoint-handlers.ts:54`）**全仓零调用**
 *    ⇒ `activeLoops` 恒空 ⇒ `handleResumeCheckpoint` 恒 **404**（batch 手动恢复不可达）；
 *  - 即使可达，`TAORLoop.resumeFromCheckpoint` **只恢复内存状态、不触发执行**
 *    （既有唯一调用者 `bootstrap.resumePendingSessions` 也只 resume + `injectSteering`）
 *    ⇒ 故 `ChatManager.resumeSuspendedSession` 必须在 resume 后**触发既有执行入口**（真再跑）。
 *
 * 本文件锁定两件事：
 *  ① `_getOrCreateTAORLoop` 后注册表**含该 sessionId**（经既有 handler 行为断言，不新增查询面）；
 *  ② `resumeSuspendedSession(sid, 'taor')` 会 resume 并**恰好调用一次既有执行入口**
 *     （`ChatOrchestrator.sendMessage`，即 TAOR 委托路径；不新增执行路径）。
 */
import { describe, expect, it } from 'bun:test';
import type http from 'http';

import { ChatManagerImpl } from '../../src/chat/ChatManager.js';
import {
  handleListCheckpoints,
  handleResumeCheckpoint,
} from '../../src/infrastructure/http/handlers/checkpoint-handlers';
import type { TAORLoop } from '../../src/query/TAORLoop.js';

/** 私有成员访问（TS `private` 仅编译期约束；此处为回归内部语义所必需） */
type ChatManagerInternals = {
  _getOrCreateTAORLoop(sessionId: string): TAORLoop;
  chatOrchestrator: {
    sendMessage(content: string, options?: unknown): Promise<unknown>;
  };
};

const internals = (cm: ChatManagerImpl): ChatManagerInternals =>
  cm as unknown as ChatManagerInternals;

/** 最小 req：`handleListCheckpoints`/`handleResumeCheckpoint` 只读 `url`/`method` */
function makeReq(url: string, method = 'GET'): http.IncomingMessage {
  return { url, method, headers: {} } as unknown as http.IncomingMessage;
}

/** 最小 res：仅需 `writeHead`/`end`（`sendJson` 用） */
function makeRes(): {
  res: http.ServerResponse;
  read: () => { status: number; body: Record<string, unknown> };
} {
  const out = { status: 0, body: '' };
  const res = {
    headersSent: false,
    writeHead: (code: number) => {
      out.status = code;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    read: () => ({
      status: out.status,
      body: out.body ? (JSON.parse(out.body) as Record<string, unknown>) : {},
    }),
  };
}

describe('TAOR 循环注册表接线（F2）', () => {
  it('_getOrCreateTAORLoop 后该 sessionId 进入注册表（handler 可取到该 loop 的端口）', async () => {
    const cm = new ChatManagerImpl();
    const sid = 'taor-wiring-1';
    const loop = internals(cm)._getOrCreateTAORLoop(sid);
    // 桩端口两方法：断言 handler 取到的端口确为**本实例**的转发
    const sentinel = [{ id: 'cp-1' }];
    loop.getCheckpointsForSession = async () => sentinel as never;
    loop.resumeFromCheckpoint = async () => true;

    const { res, read } = makeRes();
    await handleListCheckpoints(
      makeReq(`/v1/sessions/${sid}/checkpoints`),
      res
    );

    expect(read()).toEqual({ status: 200, body: { checkpoints: sentinel } });
  });

  it('未注册会话仍 404（对照：F2 修复前"恒 404"的症状）', async () => {
    const { res, read } = makeRes();
    await handleResumeCheckpoint(
      makeReq('/v1/sessions/not-registered/checkpoints/cp-9/resume', 'POST'),
      res
    );

    expect(read().status).toBe(404);
  });
});

describe('resumeSuspendedSession「真再跑」（F2 / D7）', () => {
  it("chain='taor'：resumeFromCheckpoint 后调用一次既有执行入口", async () => {
    const cm = new ChatManagerImpl();
    const sid = 'taor-resume-1';
    const loop = internals(cm)._getOrCreateTAORLoop(sid);
    let resumeCalls = 0;
    loop.getCheckpointsForSession = async () => [{ id: 'cp-latest' }] as never;
    loop.resumeFromCheckpoint = async () => {
      resumeCalls += 1;
      return true;
    };

    let execCalls = 0;
    let execOptions: { sessionId?: string } | undefined;
    internals(cm).chatOrchestrator.sendMessage = async (_content, options) => {
      execCalls += 1;
      execOptions = options as { sessionId?: string };
      return {} as never;
    };

    const resumed = await cm.resumeSuspendedSession(sid, 'taor');

    expect(resumed).toBe(true);
    expect(resumeCalls).toBe(1);
    expect(execCalls).toBe(1);
    expect(execOptions?.sessionId).toBe(sid);
  });

  it("chain='taor'：无检查点（resume 失败）⇒ 不触发执行，返回 false", async () => {
    const cm = new ChatManagerImpl();
    const sid = 'taor-resume-2';
    const loop = internals(cm)._getOrCreateTAORLoop(sid);
    loop.getCheckpointsForSession = async () => null;
    loop.resumeFromCheckpoint = async () => false;

    let execCalls = 0;
    internals(cm).chatOrchestrator.sendMessage = async () => {
      execCalls += 1;
      return {} as never;
    };

    const resumed = await cm.resumeSuspendedSession(sid, 'taor');

    expect(resumed).toBe(false);
    expect(execCalls).toBe(0);
  });
});
