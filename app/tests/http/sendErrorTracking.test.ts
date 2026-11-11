// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * C1（2026-11-11）：`sendError` 只在 **5xx** 时把错误交给 `handleError`
 * （Logger + ErrorTracker）。
 *
 * 背景：审批项已被处理后前端再查 `GET /v1/inbox/:id` ⇒ 404 `Inbox item not found`，
 * 旧实现无条件 `handleError` ⇒ 日志出现 `[api_error] Inbox item not found`
 * （`UNHANDLED_ERROR`、severity=medium），把预期的 4xx 记成"未处理错误"。
 */
import { describe, expect, it } from 'bun:test';
import type { ServerResponse } from 'node:http';
import {
  isServerFaultStatus,
  sendError,
} from '../../src/infrastructure/http/handlers/handler-utils';

function fakeRes(): {
  res: ServerResponse;
  out: { status: number; body: string };
} {
  const out = { status: 0, body: '' };
  const res = {
    writeHead(status: number) {
      out.status = status;
      return res;
    },
    end(body: string) {
      out.body = String(body);
      return res;
    },
  } as unknown as ServerResponse;
  return { res, out };
}

describe('sendError：4xx 不计入 ErrorTracker（C1）', () => {
  it('isServerFaultStatus 只认 5xx', () => {
    expect(isServerFaultStatus(400)).toBe(false);
    expect(isServerFaultStatus(404)).toBe(false);
    expect(isServerFaultStatus(500)).toBe(true);
    expect(isServerFaultStatus(503)).toBe(true);
  });

  it('404 仍返回标准错误信封（客户端可解析）', () => {
    const { res, out } = fakeRes();
    sendError(res, 'Inbox item not found', 404);
    expect(out.status).toBe(404);
    expect(JSON.parse(out.body)).toEqual({
      error: { message: 'Inbox item not found', type: 'api_error' },
    });
  });

  it('默认 500 仍是服务端故障路径（不静默）', () => {
    const { res, out } = fakeRes();
    sendError(res, new Error('boom'));
    expect(out.status).toBe(500);
    expect(JSON.parse(out.body).error.message).toBe('boom');
  });
});
