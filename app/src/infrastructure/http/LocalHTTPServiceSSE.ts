/**
 * LocalHTTPServiceSSE.ts — SSE 事件总线系统（从 LocalHTTPService 提取）
 */

import http from 'node:http';

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

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

  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      const payload = JSON.stringify({ type: 'heartbeat', ts: Date.now() });
      for (const client of clients) {
        client.write(`event: heartbeat\ndata: ${payload}\n\n`);
      }
    }, 15000);
  }

  req.on('close', () => {
    clients.delete(res);
    if (clients.size === 0 && heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
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
    client.write(`event: ${event}\ndata: ${payload}\n\n`);
  }
}

/**
 * 停止 SSE 系统（清理定时器和客户端）
 */
export function stopSSE(): void {
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
