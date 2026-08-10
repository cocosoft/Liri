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
 * GET /v1/state/all 契约测试（§十 阶段 D）
 * 验证：聚合 StateMachineRegistry 中已注册状态机（含 AppStateMachine），字段结构稳定。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type http from 'http';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import {
  initAppStateMachine,
  markAppBusy,
  markAppIdle,
} from '../../src/state/app/AppLifecycle';
import { AppState } from '../../src/state/app/types';

let tmpDir: string;
const originalDataDir = process.env.LIRI_DATA_DIR;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-all-test-'));
  process.env.LIRI_DATA_DIR = tmpDir;
  // 先接线应用状态机（注册到 StateMachineRegistry），并产生一次转移
  initAppStateMachine();
  markAppBusy('contract-test');
});

afterAll(() => {
  // 恢复共享单例到 IDLE，避免污染同进程后续测试（appLifecycle 假设初始 IDLE）
  markAppIdle('contract cleanup');
  if (originalDataDir === undefined) {
    delete process.env.LIRI_DATA_DIR;
  } else {
    process.env.LIRI_DATA_DIR = originalDataDir;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const { handleStateAll } = await import(
  '../../src/infrastructure/http/handlers/state-handlers'
);

function createRes(): { res: http.ServerResponse; body: string; status: number } {
  const out = { body: '', status: 0 };
  const res = {
    writeHead: (code: number) => {
      out.status = code;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    get body() {
      return out.body;
    },
    get status() {
      return out.status;
    },
  };
}

const ctx = {} as unknown as HandlerCtx;
const req = {} as http.IncomingMessage;

describe('GET /v1/state/all 契约（§十 阶段 D）', () => {
  test('返回 200 且 machines 包含应用状态机（id=app, state=busy）', async () => {
    const created = createRes();
    await handleStateAll(ctx, req, created.res);
    expect(created.status).toBe(200);

    const data = JSON.parse(created.body) as Record<string, unknown>;
    expect(typeof data.generatedAt).toBe('number');
    expect(Array.isArray(data.machines)).toBe(true);

    const machines = data.machines as Array<Record<string, unknown>>;
    const app = machines.find((m) => m.id === 'app');
    expect(app).toBeDefined();
    expect(app!.state).toBe(AppState.BUSY);
    expect(Array.isArray(app!.history)).toBe(true);
  });
});
