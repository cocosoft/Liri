/**
 * LocalHTTPServiceSSE.ts — SSE 事件总线系统（从 LocalHTTPService 提取）
 */

import http from 'http';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('infrastructure:http:sse');

/** SSE 客户端集合 */
const clients = new Set<http.ServerResponse>();

/** 心跳定时器 */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * U-04 残余（2026-10-19）：事件级回放。
 *
 * 广播事件带单调递增 `id:`，并保留最近 N 条到环形缓冲；前端重连时携带
 * `Last-Event-ID`，后端补发缺失事件（缓冲外/后端重启 ⇒ 无法回放，按“不补发”处理）。
 */
const REPLAY_BUFFER_SIZE = 1000;
let nextEventId = 1;
const replayBuffer: Array<{ id: number; event: string; data: string }> = [];

/** 记录一条可回放事件并返回其 id */
function appendReplayEvent(event: string, data: string): number {
  const id = nextEventId++;
  replayBuffer.push({ id, event, data });
  if (replayBuffer.length > REPLAY_BUFFER_SIZE) replayBuffer.shift();
  return id;
}

/** 读取客户端最后收到的事件 id（header / query 任一来源） */
function readLastEventId(req: http.IncomingMessage): number {
  // 测试替身可能不带 headers ⇒ 按“无 Last-Event-ID”处理
  const rawHeader = req.headers?.['last-event-id'];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (headerValue) {
    const parsed = Number.parseInt(String(headerValue), 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  // 2026-10-19（U-03/consts 门禁）：不引入 base URL 字面量，直接解析 query 串
  const rawUrl = req.url ?? '';
  const queryIndex = rawUrl.indexOf('?');
  if (queryIndex >= 0) {
    try {
      const params = new URLSearchParams(rawUrl.slice(queryIndex + 1));
      const parsed = Number.parseInt(params.get('lastEventId') || '', 10);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    } catch {
      // query 异常 ⇒ 视为无 Last-Event-ID
    }
  }
  return 0;
}

/**
 * 无客户端时停止心跳（幂等）。
 *
 * BUG-6 修复（2026-10-19）：停止心跳不能只挂在 `req.on('close')` 上 ——
 * 半开连接/代理回收 TCP 时 `close` 可能不触发，而写失败分支已经把客户端移除；
 * 若不在写失败后复判，`clients.size` 归 0 后心跳仍会每 15s 永久空转。
 */
function stopHeartbeatIfIdle(): void {
  if (clients.size > 0 || !heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  logger.debug('SSE 心跳定时器已停止（无客户端）');
}

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
  // BUG-A 修复：writeHead 只缓存响应头，首个 write() 才真正发出。
  // 不 flush 的话，浏览器 EventSource 的 onopen 要等首次心跳（15s）才触发，
  // 期间前端 sseService.isConnected()=false，心跳保活与重连判断失真。
  res.flushHeaders();

  // U-04 残余：先补发 Last-Event-ID 之后的事件，再登记为实时客户端 ——
  // 顺序不可颠倒，否则补发期间的新广播会插到补发事件之前（前端按 id 递增消费）。
  const lastEventId = readLastEventId(req);
  if (lastEventId > 0) {
    let replayed = 0;
    for (const item of replayBuffer) {
      if (item.id <= lastEventId) continue;
      try {
        res.write(
          `id: ${item.id}\nevent: ${item.event}\ndata: ${item.data}\n\n`
        );
        replayed++;
      } catch {
        break;
      }
    }
    logger.info('SSE 断线补发', { lastEventId, replayed });
  }

  clients.add(res);
  logger.info('SSE 客户端已连接', { total: clients.size });

  if (!heartbeatTimer) {
    logger.debug('启动 SSE 心跳定时器', { intervalMs: 15000 });
    heartbeatTimer = setInterval(() => {
      logger.debug('SSE 心跳广播 tick', { clients: clients.size });
      const payload = JSON.stringify({ type: 'heartbeat', ts: Date.now() });
      // 快照遍历：边删边迭代对 Set 安全，但快照可避免将来换容器时踩坑
      for (const client of [...clients]) {
        try {
          client.write(`event: heartbeat\ndata: ${payload}\n\n`);
        } catch {
          logger.warn('SSE 心跳发送失败，移除客户端');
          clients.delete(client);
          // 主动收尾响应，促使 close 事件触发（半开连接下 close 可能永不触发）
          try {
            client.end();
          } catch {
            // 连接已断开，忽略
          }
        }
      }
      // 写失败可能移除了最后一个客户端 ⇒ 此处复判并停表
      stopHeartbeatIfIdle();
    }, 15000);
    heartbeatTimer.unref?.();
  }

  req.on('close', () => {
    clients.delete(res);
    logger.info('SSE 客户端已断开', { total: clients.size });
    stopHeartbeatIfIdle();
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
  // U-04 残余：带 id 的广播才可被 Last-Event-ID 回放
  const eventId = appendReplayEvent(event, payload);
  for (const client of [...clients]) {
    try {
      client.write(`id: ${eventId}\nevent: ${event}\ndata: ${payload}\n\n`);
    } catch {
      // 客户端已断开但尚未从 Set 中清理，静默移除
      clients.delete(client);
      try {
        client.end();
      } catch {
        // 连接已断开，忽略
      }
      logger.warn('SSE 广播时发现已断开客户端，已移除', {
        event,
        eventClientCount: clients.size,
      });
    }
  }
  // 同一出口：广播写失败也可能移除最后一个客户端
  stopHeartbeatIfIdle();
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
  // U-04 残余：回放缓冲随进程生命周期清理（测试/重启不跨实例串数据）
  replayBuffer.length = 0;
  nextEventId = 1;
}

/**
 * 获取 SSE 客户端数量
 */
export function getSSEClientCount(): number {
  return clients.size;
}
