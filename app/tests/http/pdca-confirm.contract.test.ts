// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `POST /v1/pdca/:taskId/confirm` 契约（2026-10-31 假成功修复）。
 *
 * 缺陷：app 侧编排器**无** `confirm` 方法（`taskOpsPorts.ts` 端口注释自述），旧实现
 * `await orchestrator.confirm?.(undefined)` 恒 no-op 却回 `{ok:true}`；编排器缺失时回
 * `200 + {error:'Not available'}` ⇒ 调用方无法区分"已确认"与"什么都没做"。
 *
 * 现口径：任务不存在 ⇒ **404**；能力未实现 ⇒ **501**；真正执行 ⇒ **200 {ok:true}**。
 * 隔离 `LIRI_HOME` / `LIRI_DATA_DIR`（与 `pdca-status.contract.test.ts` 同法）。
 */
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import type http from 'http';

const isolateDir = mkdtempSync(join(tmpdir(), 'pdca-confirm-http-'));
const prevLiriHome = process.env.LIRI_HOME;
const prevLiriDataDir = process.env.LIRI_DATA_DIR;
process.env.LIRI_HOME = isolateDir;
process.env.LIRI_DATA_DIR = isolateDir;

afterAll(() => {
  if (prevLiriHome === undefined) delete process.env.LIRI_HOME;
  else process.env.LIRI_HOME = prevLiriHome;
  if (prevLiriDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = prevLiriDataDir;
});

const { handlePdcaConfirm } =
  await import('../../src/infrastructure/http/handlers/pdca-handlers');
const { getCoreAPI } = await import('../../src/runtime/api/CoreAPIImpl');

function createRes(): {
  res: http.ServerResponse;
  read: () => { status: number; body: Record<string, unknown> };
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
    read: () => ({
      status: out.status,
      body: JSON.parse(out.body) as Record<string, unknown>,
    }),
  };
}

function makeReq(): http.IncomingMessage {
  const req = new Readable({ read() {} }) as unknown as http.IncomingMessage & {
    headers: Record<string, string>;
  };
  req.headers = { host: 'localhost' };
  req.push(null);
  return req;
}

async function call(taskId: string) {
  const created = createRes();
  await handlePdcaConfirm(makeReq(), created.res, taskId);
  return created.read();
}

async function createOrchestrator(taskId: string) {
  const port = await getCoreAPI().getTaskOpsPort();
  return port.getOrCreatePdcaOrchestrator(taskId);
}

const CONFIRM_PROBE = 'pdca_confirm_probe_no_impl';
const CONFIRM_WIRED = 'pdca_confirm_probe_wired';

afterEach(async () => {
  // 清掉本次创建的编排器（模块级注册表 `activeOrchestrators`），避免污染同进程后续用例。
  // 端口刻意不暴露 `dispose`（无生命周期管理）⇒ 测试侧按实现形态收窄。
  const port = await getCoreAPI().getTaskOpsPort();
  for (const id of [CONFIRM_PROBE, CONFIRM_WIRED]) {
    const orchestrator = (await port.getPdcaOrchestrator(id)) as unknown as {
      dispose?: () => void;
    } | null;
    orchestrator?.dispose?.();
  }
});

describe('POST /v1/pdca/:taskId/confirm 契约（不再假成功）', () => {
  test('任务不存在 ⇒ 404 {ok:false,error:not_found}（原实现回 200）', async () => {
    const { status, body } = await call('pdca_confirm_missing_xyz');
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('not_found');
    expect(body.taskId).toBe('pdca_confirm_missing_xyz');
  });

  test('编排器无 confirm 能力 ⇒ 501 {ok:false,error:not_implemented}', async () => {
    await createOrchestrator(CONFIRM_PROBE);
    const { status, body } = await call(CONFIRM_PROBE);
    expect(status).toBe(501);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('not_implemented');
  });

  test('编排器具备 confirm ⇒ 真正调用并回 200 {ok:true}', async () => {
    const orchestrator = await createOrchestrator(CONFIRM_WIRED);
    const wired = orchestrator as unknown as {
      confirm?: (decision?: unknown) => Promise<void>;
    };
    let called = 0;
    wired.confirm = async () => {
      called += 1;
    };

    const { status, body } = await call(CONFIRM_WIRED);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(called).toBe(1);
  });
});
