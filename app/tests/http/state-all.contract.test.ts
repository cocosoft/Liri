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
// 与 handler **同一说明符**（`@openliri/infra/state` 桶）取注册表与 AppLifecycle：
// `state-handlers` 内部是 `await import('@openliri/infra/state')`，两侧必须看到同一份模块实例。
import {
  AppState,
  getAppStateMachine,
  initAppStateMachine,
  markAppBusy,
  markAppIdle,
  StateMachineRegistry,
} from '@openliri/infra/state';
import type { StateMachine } from '@openliri/infra/state';

/** AppLifecycle 的机器 ID（与 `AppLifecycle.ts` 的 `MACHINE_ID` 一致） */
const APP_MACHINE_ID = 'app';

let tmpDir: string;
const originalDataDir = process.env.LIRI_DATA_DIR;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-all-test-'));
  process.env.LIRI_DATA_DIR = tmpDir;
  // 先接线应用状态机（注册到 StateMachineRegistry），并产生一次转移
  initAppStateMachine();

  // 取证（随机顺序实测）：本用例失败形态是 `machines.find(m => m.id === 'app') === undefined`，
  // 而非「状态不对」。原因：同进程 `tests/state/engine/StateMachine.test.ts` 的
  // `StateMachineRegistry.reset()` 会换掉单例，而 AppLifecycle 的模块级 `machineCache`
  // 仍持有旧实例 ⇒ `initAppStateMachine()` 不再重新登记 ⇒ handler 看到的是空注册表。
  // 此处按 handler 的取用方式（同说明符）自备登记，让「handler 能看到的那一份」确有 'app'。
  const registry = StateMachineRegistry.getInstance();
  const appMachine = getAppStateMachine() as unknown as StateMachine<string>;
  const registered = registry.find(APP_MACHINE_ID);
  if (registered !== (appMachine as unknown as StateMachine<string>)) {
    if (registered) registry.unregister(APP_MACHINE_ID);
    registry.register(APP_MACHINE_ID, appMachine);
  }

  // 不假设前置状态：`PAUSED → BUSY` 不在转移表里（`APP_TRANSITIONS`），若全局单例被前序
  // 用例/快照留在 PAUSED，`markAppBusy()` 会返回 false 且状态不变（随机顺序下曾因此失败）。
  if (!markAppBusy('contract-test')) {
    markAppIdle('contract-test: 归位 IDLE 后再转 BUSY');
    markAppBusy('contract-test');
  }
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

const { handleStateAll } =
  await import('../../src/infrastructure/http/handlers/state-handlers');

function createRes(): {
  res: http.ServerResponse;
  body: string;
  status: number;
} {
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
    // 调用 handler 前先证明「handler 同一说明符能看到的注册表」确有 'app'
    // （若两侧是不同的模块实例，这里会先失败，暴露真实差异）
    expect(
      StateMachineRegistry.getInstance().find(APP_MACHINE_ID)
    ).toBeDefined();

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
