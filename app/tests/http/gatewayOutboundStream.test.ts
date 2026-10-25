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
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope';
import type { Principal } from '@openliri/kernel/identity/principal';
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

  // ─── T25-01：身份绑定 + 前置过滤（跨租户不串流）────────────────────────
  it('已认证连接的投影按身份隔离：A 收不到 B 发布的投影', async () => {
    const alice: Principal = { tenantId: 'acme', userId: 'alice', roles: [] };
    const bob: Principal = { tenantId: 'acme', userId: 'bob', roles: [] };

    const { req, res, chunks } = makePair();
    await runWithPrincipal(alice, () => handleGatewayOutboundStream(req, res));

    runWithPrincipal(bob, () =>
      publishStateProjection({
        domain: 'orchestration',
        primitive: 'RUNNING',
        orchestrationId: 'bob-plan',
      })
    );
    expect(chunks.join('')).not.toContain('bob-plan');

    runWithPrincipal(alice, () =>
      publishStateProjection({
        domain: 'orchestration',
        primitive: 'RUNNING',
        orchestrationId: 'alice-plan',
      })
    );
    expect(chunks.join('')).toContain('"orchestrationId":"alice-plan"');
  });

  it('本地身份只收本地发布的投影（fail-closed）', async () => {
    const alice: Principal = { tenantId: 'acme', userId: 'alice', roles: [] };

    const { req, res, chunks } = makePair();
    await handleGatewayOutboundStream(req, res);

    runWithPrincipal(alice, () =>
      publishStateProjection({
        domain: 'orchestration',
        primitive: 'RUNNING',
        orchestrationId: 'alice-plan',
      })
    );
    expect(chunks.join('')).not.toContain('alice-plan');

    publishStateProjection({
      domain: 'orchestration',
      primitive: 'SETTLED',
      orchestrationId: 'local-plan',
    });
    expect(chunks.join('')).toContain('"orchestrationId":"local-plan"');
  });
});
