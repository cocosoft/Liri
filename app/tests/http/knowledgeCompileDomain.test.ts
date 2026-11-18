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
 * PR #14 接线（2026-11-19）：`POST /v1/knowledge/compile` 的 `domain` 必须真正走到编译器。
 *
 * 该链路容易"半路丢字段"（`handler → kops.runKnowledgeCompile → runKnowledgeCompile → compile`），
 * 丢一处就静默退回全局目录、编译"看起来成功但编错了地方"。本用例锁三件事：
 *  ① 已注册域 ⇒ 202，且 `{ force, domain }` 原样转发；
 *  ② 未注册域 ⇒ 400，且**不触达**编译；
 *  ③ 不传 domain ⇒ 转发 `{ force }`，响应体不带 `domain` 键。
 */
import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { PassThrough } from 'node:stream';
import type http from 'http';

import { CoreAPIImpl } from '../../src/runtime/api/CoreAPIImpl';
import { DomainManager } from '../../src/knowledge/domain/DomainManager';
import { handleKnowledgeCompile } from '../../src/infrastructure/http/handlers/knowledge-handlers';

const compileCalls: Array<Record<string, unknown> | undefined> = [];
let registeredDomain = 'finance';

const opsSpy = spyOn(
  CoreAPIImpl.prototype,
  'getKnowledgeOpsPort'
).mockImplementation(
  async () =>
    ({
      runKnowledgeCompile: async (
        _ai: unknown,
        opts?: Record<string, unknown>
      ) => {
        compileCalls.push(opts);
      },
    }) as never
);
const aiSpy = spyOn(CoreAPIImpl.prototype, 'getAiOpsPort').mockImplementation(
  async () => ({ getAiServiceHandle: async () => ({}) }) as never
);
const configSpy = spyOn(
  DomainManager.prototype,
  'getConfig'
).mockImplementation(
  async (name: string) => (name === registeredDomain ? { name } : null) as never
);

afterAll(() => {
  opsSpy.mockRestore();
  aiSpy.mockRestore();
  configSpy.mockRestore();
});

beforeEach(() => {
  compileCalls.length = 0;
  registeredDomain = 'finance';
});

/** 造 req/res 替身（readRequestBody 只读流 + content-length） */
function makeExchange(body: unknown): {
  req: http.IncomingMessage;
  res: { status?: number; payload: string };
  resObj: http.ServerResponse;
} {
  const raw = JSON.stringify(body);
  const req = new PassThrough() as unknown as http.IncomingMessage;
  (req as unknown as { headers: Record<string, string> }).headers = {
    'content-length': String(Buffer.byteLength(raw)),
  };
  const res: { status?: number; payload: string } = { payload: '' };
  const resObj = {
    writeHead: (status: number) => {
      res.status = status;
      return resObj;
    },
    end: (chunk?: string) => {
      res.payload = chunk ?? '';
      return resObj;
    },
  } as unknown as http.ServerResponse;
  req.push(raw);
  req.push(null);
  return { req, res, resObj };
}

/** 等后台 setImmediate 里的转发跑完 */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('POST /v1/knowledge/compile：domain 透传（PR #14）', () => {
  it('已注册域 ⇒ 202 且转发 { force, domain }', async () => {
    const { req, res, resObj } = makeExchange({
      force: true,
      domain: 'finance',
    });
    await handleKnowledgeCompile(req, resObj);
    await flush();

    expect(res.status).toBe(202);
    expect(JSON.parse(res.payload)).toMatchObject({
      started: true,
      domain: 'finance',
    });
    expect(compileCalls).toHaveLength(1);
    expect(compileCalls[0]).toMatchObject({ force: true, domain: 'finance' });
  });

  it('未注册域 ⇒ 400，且不触达编译', async () => {
    const { req, res, resObj } = makeExchange({ domain: 'typo-domain' });
    await handleKnowledgeCompile(req, resObj);
    await flush();

    expect(res.status).toBe(400);
    expect(res.payload).toContain('domain not found');
    expect(compileCalls).toHaveLength(0);
  });

  it('不传 domain ⇒ 仅转发 force，响应体无 domain 键', async () => {
    const { req, res, resObj } = makeExchange({ force: false });
    await handleKnowledgeCompile(req, resObj);
    await flush();

    expect(res.status).toBe(202);
    expect('domain' in JSON.parse(res.payload)).toBe(false);
    expect(compileCalls).toHaveLength(1);
    expect(compileCalls[0]).toMatchObject({ force: false });
    expect(compileCalls[0]).not.toHaveProperty('domain');
  });
});
