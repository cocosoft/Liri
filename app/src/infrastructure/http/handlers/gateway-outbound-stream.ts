/**
 * gateway-outbound-stream — 统一出站管道的 HTTP SSE 订阅面（U-15，2026-10-18）。
 *
 * `GET /v1/gateway/outbound/stream`
 *
 * 只订阅四原语投影（`StateProjectionBroadcast`），事件名固定 `state_projection`；
 * 不携带原生细粒度状态，不做任何裁决。投影生产仍由
 * `FEATURE_STATE_PROJECTION_BROADCAST`（默认关）门控 ⇒ 默认连接可建立但无业务事件。
 *
 * 通道插件/外部消费者可通过本端点订阅；主内核不感知订阅者。
 */

import type http from 'http';
import { registerProjectionOutboundSink } from '../../../state/engine/projectionOutbound.js';
import type { StateProjectionBroadcast } from '../../../state/engine/projectionBroker.js';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('infrastructure:http:gatewayOutbound');

/** SSE 事件名（对外契约；改名需同步消费者） */
export const OUTBOUND_STATE_PROJECTION_EVENT = 'state_projection';

/**
 * 处理 `GET /v1/gateway/outbound/stream`。
 *
 * 生命周期：连接建立 → 注册 sink → 心跳 15s → `req.close` 注销并清理定时器。
 */
export async function handleGatewayOutboundStream(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  // 立即 flush，确保 EventSource onopen 不必等首个心跳
  res.flushHeaders();
  res.write(': connected\n\n');

  const sink = {
    name: 'http-sse',
    deliver(projection: StateProjectionBroadcast): void {
      res.write(
        `event: ${OUTBOUND_STATE_PROJECTION_EVENT}\ndata: ${JSON.stringify(projection)}\n\n`
      );
    },
  };
  const unregister = registerProjectionOutboundSink(sink);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      // 写失败由 req close 统一清理
    }
  }, 15_000);
  heartbeat.unref?.();

  req.on('close', () => {
    unregister();
    clearInterval(heartbeat);
    logger.info('gateway outbound stream 客户端已断开');
  });
}
