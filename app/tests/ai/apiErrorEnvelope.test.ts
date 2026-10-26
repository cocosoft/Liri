/**
 * W26-23（2026-10-26）：模型管理 REST API 错误响应体契约
 *
 * 背景：`ai/api/utils.ts#sendError` 与 `handlers/handler-utils.ts#sendError` 是**两个不同实现**
 * （前者收已格式化 message、默认 400、不记账；后者收 unknown、默认 500、经 handleError 记账）。
 * 两者本该共享同一**响应体形状**（`{ error: { message, type } }`），此前模型 API 侧漏了 `type`
 * ⇒ 按 `error.type` 分派的消费方会掉进 undefined。本用例把这个形状钉住。
 */

import { describe, expect, it } from 'bun:test';
import type http from 'node:http';

import { sendError, sendJson } from '../../src/ai/api/utils';

interface Captured {
  status?: number;
  body?: string;
}

function makeRes(headersSent = false): {
  res: http.ServerResponse;
  out: Captured;
} {
  const out: Captured = {};
  const res = {
    headersSent,
    writeHead(status: number): void {
      out.status = status;
    },
    end(body: string): void {
      out.body = body;
    },
  } as unknown as http.ServerResponse;
  return { res, out };
}

describe('ai/api/utils#sendError（W26-23 响应体契约）', () => {
  it('默认 400，且响应体带 type=invalid_request_error', () => {
    const { res, out } = makeRes();
    sendError(res, '缺少 modelId');

    expect(out.status).toBe(400);
    expect(JSON.parse(out.body ?? '')).toEqual({
      error: { message: '缺少 modelId', type: 'invalid_request_error' },
    });
  });

  it('显式状态码原样透传（如 404）', () => {
    const { res, out } = makeRes();
    sendError(res, 'not found', 404);

    expect(out.status).toBe(404);
    expect(JSON.parse(out.body ?? '')).toEqual({
      error: { message: 'not found', type: 'invalid_request_error' },
    });
  });

  it('headersSent 后不重复写响应（sendJson 的保护仍然生效）', () => {
    const { res, out } = makeRes(true);
    sendError(res, 'late error');

    expect(out.status).toBeUndefined();
    expect(out.body).toBeUndefined();
  });

  it('正常 JSON 响应不受影响（回归）', () => {
    const { res, out } = makeRes();
    sendJson(res, { ok: true });

    expect(out.status).toBe(200);
    expect(JSON.parse(out.body ?? '')).toEqual({ ok: true });
  });
});
