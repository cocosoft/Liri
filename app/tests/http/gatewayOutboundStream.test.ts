/**
 * U-15：`GET /v1/gateway/outbound/stream` SSE 订阅面。
 *
 * 覆盖：
 * ① 连接后写出 SSE 头与 `state_projection` 事件；
 * ② 断开时注销 sink（不泄漏全局订阅）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { EventEmitter } from 'events';
import type http from 'http';
import {
  handleGatewayOutboundStream,
  OUTBOUND_STATE_PROJECTION_EVENT,
} from '../../src/infrastructure/http/handlers/gateway-outbound-stream.js';
import { publishStateProjection } from '../../src/state/engine/projectionBroker.js';
import {
  getProjectionOutboundSinkCount,
  resetProjectionOutboundForTest,
} from '../../src/state/engine/projectionOutbound.js';

const FLAG_ENV = 'FEATURE_STATE_PROJECTION_BROADCAST';

beforeEach(() => {
  resetProjectionOutboundForTest();
  process.env[FLAG_ENV] = 'true';
});

afterEach(() => {
  resetProjectionOutboundForTest();
  delete process.env[FLAG_ENV];
});

function makePair(): {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  chunks: string[];
} {
  const req = new EventEmitter() as unknown as http.IncomingMessage;
  const chunks: string[] = [];
  const res = {
    writeHead: () => res,
    flushHeaders: () => {},
    write: (chunk: string) => {
      chunks.push(String(chunk));
      return true;
    },
  } as unknown as http.ServerResponse;
  return { req, res, chunks };
}

describe('U-15 gateway outbound stream', () => {
  it('SSE 事件名为 state_projection，载荷为四原语投影', async () => {
    const { req, res, chunks } = makePair();
    await handleGatewayOutboundStream(req, res);
    expect(getProjectionOutboundSinkCount()).toBe(1);

    publishStateProjection({
      domain: 'orchestration',
      primitive: 'SUSPENDED',
      orchestrationId: 'plan-9',
    });

    const body = chunks.join('');
    expect(body).toContain(`event: ${OUTBOUND_STATE_PROJECTION_EVENT}`);
    expect(body).toContain('"primitive":"SUSPENDED"');
    expect(body).toContain('"orchestrationId":"plan-9"');
  });

  it('断开时注销 sink', async () => {
    const { req, res } = makePair();
    await handleGatewayOutboundStream(req, res);
    expect(getProjectionOutboundSinkCount()).toBe(1);
    req.emit('close');
    expect(getProjectionOutboundSinkCount()).toBe(0);
  });
});
