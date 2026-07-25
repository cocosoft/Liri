/**
 * LocalHTTPServiceSSE.ts — SSE 事件总线系统（从 LocalHTTPService 提取）
 */

import http from 'http';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'infrastructure:http:sse',
  level: LogLevel.INFO,
});

/** SSE 客户端集合 */
const clients = new Set<http.ServerResponse>();

/** 心跳定时器 */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 处理 SSE 事件订阅
 */
export async function handleEvents(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  clients.add(res);
  logger.info('SSE 客户端已连接', { total: clients.size });

  if (!heartbeatTimer) {
    logger.debug('启动 SSE 心跳定时器', { intervalMs: 15000 });
    heartbeatTimer = setInterval(() => {
      const payload = JSON.stringify({ type: 'heartbeat', ts: Date.now() });
      for (const client of clients) {
        try {
          client.write(`event: heartbeat\ndata: ${payload}\n\n`);
        } catch {
          clients.delete(client);
        }
      }
    }, 15000);
  }

  req.on('close', () => {
    clients.delete(res);
    logger.info('SSE 客户端已断开', { total: clients.size });
    if (clients.size === 0 && heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      logger.debug('SSE 心跳定时器已停止（无客户端）');
    }
  });
}

/**
 * 广播事件到所有 SSE 客户端
 */
export function broadcastEvent(
  event: string,
  data: Record<string, unknown>
): void {
  const payload = JSON.stringify({ ...data, ts: Date.now() });
  for (const client of clients) {
    try {
      client.write(`event: ${event}\ndata: ${payload}\n\n`);
    } catch {
      // 客户端已断开但尚未从 Set 中清理，静默移除
      clients.delete(client);
      logger.warn('SSE 广播时发现已断开客户端，已移除', {
        event,
        eventClientCount: clients.size,
      });
    }
  }
}

/**
 * 停止 SSE 系统（清理定时器和客户端）
 */
export function stopSSE(): void {
  logger.info('SSE 系统已停止', { clientCount: clients.size });
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  clients.clear();
}

/**
 * 获取 SSE 客户端数量
 */
export function getSSEClientCount(): number {
  return clients.size;
}
