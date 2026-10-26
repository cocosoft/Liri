// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1-1（2026-10-27）：沙箱配置/状态响应带 `runtimeIsolation`。
 *
 * 为什么需要：页面上的 `full/standard/readonly` 只进 `PERMISSION_RANK`（S3），
 * 而沙箱豁免链在 S1（`mode === 'none'`）已先拒 ⇒ 无隔离后端时该级别对实际行为**零影响**。
 * 露出 `runtimeIsolation` 才能让 UI 诚实降级（禁用控件 + 说明），而不是"配了没用"。
 *
 * 覆盖：
 * ① SPI 未注册（空快照）⇒ `GET /v1/sandbox/config` 的 `runtimeIsolation` 为 `'none'`，
 *    且 `enabled` / `permissionLevel` 仍在（未挤掉既有字段）；
 * ② `GET /v1/sandbox/status` 同样带该字段，且为字符串白名单内取值；
 * ③ 两个端点的取值**同源**（同一快照），不会一处 `none` 一处别的。
 */
import { describe, expect, it } from 'bun:test';
import type http from 'http';
import {
  handleGetSandboxConfig,
  handleGetSandboxStatus,
} from '../../src/infrastructure/http/handlers/sandbox-handlers.js';

const ALLOWED_ISOLATION = ['landlock', 'container', 'ssh', 'pty', 'none'];

interface Captured {
  res: http.ServerResponse;
  body: () => string;
  status: () => number;
}

function createRes(): Captured {
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
    body: () => out.body,
    status: () => out.status,
  };
}

const req = { method: 'GET' } as unknown as http.IncomingMessage;

async function getConfig(): Promise<Record<string, unknown>> {
  const captured = createRes();
  await handleGetSandboxConfig(req, captured.res);
  expect(captured.status()).toBe(200);
  return JSON.parse(captured.body()) as Record<string, unknown>;
}

async function getStatus(): Promise<Record<string, unknown>> {
  const captured = createRes();
  await handleGetSandboxStatus(req, captured.res);
  expect(captured.status()).toBe(200);
  return JSON.parse(captured.body()) as Record<string, unknown>;
}

describe('sandbox runtimeIsolation（P1-1）', () => {
  it('SPI 未注册 ⇒ config.runtimeIsolation 为 none，既有字段不丢', async () => {
    const body = await getConfig();
    expect(body.runtimeIsolation).toBe('none');
    expect(typeof body.enabled).toBe('boolean');
    expect(['full', 'standard', 'readonly']).toContain(
      body.permissionLevel as string
    );
  });

  it('status 也带 runtimeIsolation（白名单取值）', async () => {
    const body = await getStatus();
    expect(ALLOWED_ISOLATION).toContain(body.runtimeIsolation as string);
  });

  it('config 与 status 的 runtimeIsolation 同源', async () => {
    const [cfg, st] = await Promise.all([getConfig(), getStatus()]);
    expect(cfg.runtimeIsolation).toBe(st.runtimeIsolation);
  });
});
