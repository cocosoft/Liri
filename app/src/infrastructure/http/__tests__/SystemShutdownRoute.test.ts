// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-12：`POST /v1/system/shutdown` 优雅关闭入口。
 *
 * 立论同 `AdminWriteRoutes.test.ts`：**"接口存在" ≠ "真的会关"**。本文件钉死三件事：
 *   ① 宿主未接线 ⇒ `503` 且**不触发**任何关闭动作（不假装已受理，fail-closed）；
 *   ② 已接线 ⇒ `202` + 触发一次关闭链；
 *   ③ 该路径属管理写（本机无 Bearer 放行、已登录非 admin 拒绝由 `checkAdminRequest` 负责）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import type http from 'node:http';
import {
  hasShutdownRequester,
  registerShutdownRequester,
  requestGracefulShutdown,
} from '../shutdownRequest';
import { handleShutdownRequest } from '../handlers/routes/system-routes';
import { isAdminWriteRoute } from '../adminWriteRoutes';

/** 最小 `ServerResponse` 替身：只实现 `json()` 用到的 `writeHead` / `end` */
function createFakeRes(): {
  res: http.ServerResponse;
  status: () => number | undefined;
  body: () => unknown;
} {
  let statusCode: number | undefined;
  let payload = '';
  const res = {
    writeHead: (code: number) => {
      statusCode = code;
      return res;
    },
    end: (chunk?: unknown) => {
      if (typeof chunk === 'string') payload += chunk;
      return res;
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    status: () => statusCode,
    body: () => (payload ? JSON.parse(payload) : undefined),
  };
}

afterEach(() => {
  registerShutdownRequester(null);
});

describe('POST /v1/system/shutdown', () => {
  it('宿主未接线 ⇒ 503，且不触发关闭', async () => {
    expect(hasShutdownRequester()).toBe(false);
    const { res, status } = createFakeRes();
    await handleShutdownRequest(res);
    expect(status()).toBe(503);
    // 未注册时 requestGracefulShutdown 必须返回 false（调用方据此不得宣称已受理）
    expect(requestGracefulShutdown()).toBe(false);
  });

  it('宿主已接线 ⇒ 202 并触发一次关闭链', async () => {
    let calls = 0;
    registerShutdownRequester(() => {
      calls += 1;
    });
    expect(hasShutdownRequester()).toBe(true);

    const { res, status, body } = createFakeRes();
    await handleShutdownRequest(res);
    expect(status()).toBe(202);
    expect(body()).toEqual({ status: 'shutting_down' });

    // 关闭链由 setImmediate 延后一拍（先让 202 写出）
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toBe(1);
  });

  it('该路径属管理写（段边界；`/v1/system/shutdownx` 不算）', () => {
    expect(isAdminWriteRoute('POST', '/v1/system/shutdown')).toBe(true);
    expect(isAdminWriteRoute('post', '/v1/system/shutdown')).toBe(true);
    expect(isAdminWriteRoute('GET', '/v1/system/shutdown')).toBe(false);
    expect(isAdminWriteRoute('POST', '/v1/system/shutdownx')).toBe(false);
  });
});
