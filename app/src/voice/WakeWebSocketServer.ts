/**
 * WakeWebSocketServer
 * 独立的 /wake WebSocket 端点，用于实时广播唤醒词检测事件
 * 前端通过此 WS 连接接收 wakeword_detected 事件，触发自动录音
 *
 * 使用 Node.js 内置 http + crypto + net 模块实现 RFC 6455
 * 零第三方依赖
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';
import { createHash, randomUUID } from 'crypto';
import type { WakeDetectionResult } from './types';
import { withTraceContextFromRequest } from '../monitoring/tracing/traceContextExtractor';

const logger = getLogger('voice:wakews');

/** WebSocket 魔术 GUID (RFC 6455) */
const MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** 操作码 */
const enum OpCode {
  CONTINUATION = 0x0,
  TEXT = 0x1,
  BINARY = 0x2,
  CLOSE = 0x8,
  PING = 0x9,
  PONG = 0xa,
}

/** 连接状态 */
const enum ConnState {
  OPEN,
  CLOSING,
  CLOSED,
}

/** 心跳间隔（毫秒） */
const HEARTBEAT_INTERVAL_MS = 30000;

/** 最大允许丢失 PONG 次数 */
const MAX_MISSED_PONGS = 2;

/** 唤醒 WS 客户端内部状态 */
interface WakeWsClient {
  id: string;
  socket: Socket;
  state: ConnState;
  connectedAt: number;
  missedPongs: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  closeHandler: (() => void) | null;
}

/** 空闲客户端集合 */
const wakeClients = new Map<string, WakeWsClient>();

/**
 * 获取当前连接的唤醒 WS 客户端数量
 */
export function getWakeClientCount(): number {
  return wakeClients.size;
}

/**
 * 生成 WebSocket Accept Key
 */
function generateAcceptKey(key: string): string {
  const sha1 = createHash('sha1');
  sha1.update(key + MAGIC_GUID);
  return sha1.digest('base64');
}

/**
 * 发送文本帧（服务端 → 客户端，不掩码）
 */
function sendTextFrame(socket: Socket, text: string): void {
  try {
    const payload = Buffer.from(text, 'utf-8');
    const frame = buildFrame(OpCode.TEXT, payload);
    socket.write(frame);
  } catch (e) {
    void handleError(e, { module: 'voice:wakews', action: 'sendTextFrame' });
  }
}

/**
 * 构建 WebSocket 帧（服务端→客户端，不掩码）
 */
function buildFrame(opcode: number, payload: Buffer): Buffer {
  let headerSize = 2;

  if (payload.length > 125 && payload.length <= 65535) {
    headerSize += 2;
  } else if (payload.length > 65535) {
    headerSize += 8;
  }

  const frame = Buffer.alloc(headerSize + payload.length);
  frame[0] = 0x80 | opcode;

  if (payload.length <= 125) {
    frame[1] = payload.length;
  } else if (payload.length <= 65535) {
    frame[1] = 126;
    frame.writeUInt16BE(payload.length, 2);
  } else {
    frame[1] = 127;
    frame.writeUInt32BE(0, 2);
    frame.writeUInt32BE(payload.length, 6);
  }

  payload.copy(frame, headerSize);
  return frame;
}

/**
 * 解析 WebSocket 帧（仅用于接收客户端的 PONG/CLOSE）
 */
function parseFrame(
  buffer: Buffer
): { opcode: number; payload: Buffer; totalLength: number } | null {
  if (buffer.length < 2) return null;

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const opcode = firstByte & 0x0f;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < 4) return null;
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null;
    const high = buffer.readUInt32BE(2);
    const low = buffer.readUInt32BE(6);
    payloadLength = high * 0x100000000 + low;
    offset = 10;
  }

  const headerEnd = offset + payloadLength;

  if (buffer.length < headerEnd) return null;

  const payload = buffer.subarray(headerEnd, headerEnd + payloadLength);

  return { opcode, payload, totalLength: headerEnd };
}

/**
 * 处理客户端数据帧（仅关心 PONG 和 CLOSE）
 */
function handleClientFrame(client: WakeWsClient, buffer: Buffer): Buffer {
  let remaining = buffer;

  while (remaining.length >= 2) {
    const frame = parseFrame(remaining);
    if (!frame) break;

    remaining = remaining.slice(frame.totalLength);

    switch (frame.opcode) {
      case OpCode.PONG:
        client.missedPongs = 0;
        break;

      case OpCode.CLOSE:
        cleanupClient(client, 1000, 'remote close');
        return remaining;

      case OpCode.PING:
        sendPongFrame(client.socket, frame.payload);
        break;

      case OpCode.TEXT:
        // 客户端发来的文本消息忽略（唤醒 WS 是只读广播通道）
        break;

      default:
        break;
    }
  }

  return remaining;
}

/**
 * 发送 PONG 帧
 */
function sendPongFrame(socket: Socket, payload: Buffer): void {
  try {
    const frame = buildFrame(OpCode.PONG, payload);
    socket.write(frame);
  } catch (e) {
    void handleError(e, { module: 'voice:wakews', action: 'sendPongFrame' });
  }
}

/**
 * 开始心跳检测
 */
function startHeartbeat(client: WakeWsClient): void {
  client.heartbeatTimer = setInterval(() => {
    if (client.state !== ConnState.OPEN) {
      stopHeartbeat(client);
      return;
    }

    client.missedPongs++;
    if (client.missedPongs > MAX_MISSED_PONGS) {
      logger.warn('唤醒 WS 客户端心跳超时，断开连接', {
        clientId: client.id,
      });
      cleanupClient(client, 1001, 'heartbeat timeout');
      return;
    }

    sendPingFrame(client.socket);
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * 发送 PING 帧
 */
function sendPingFrame(socket: Socket): void {
  try {
    const frame = buildFrame(OpCode.PING, Buffer.alloc(0));
    socket.write(frame);
  } catch (e) {
    void handleError(e, { module: 'voice:wakews', action: 'sendPingFrame' });
  }
}

/**
 * 停止心跳检测
 */
function stopHeartbeat(client: WakeWsClient): void {
  if (client.heartbeatTimer !== null) {
    clearInterval(client.heartbeatTimer);
    client.heartbeatTimer = null;
  }
}

/**
 * 清理并移除客户端
 */
function cleanupClient(
  client: WakeWsClient,
  code: number,
  _reason: string
): void {
  if (client.state === ConnState.CLOSED) return;

  client.state = ConnState.CLOSING;
  stopHeartbeat(client);

  // 发送关闭帧
  try {
    const closePayload = Buffer.alloc(2);
    closePayload.writeUInt16BE(code, 0);
    const frame = buildFrame(OpCode.CLOSE, closePayload);
    client.socket.write(frame);
  } catch (e) {
    void handleError(e, { module: 'voice:wakews', action: 'cleanupSendClose' });
  }

  client.socket.end();
  client.state = ConnState.CLOSED;
  wakeClients.delete(client.id);
  client.closeHandler?.();
}

/**
 * 处理 /wake 端点的 WebSocket 升级请求
 * 由 WebChannel 在路由匹配时调用
 *
 * @param req HTTP 请求
 * @param res HTTP 响应
 * @returns 是否成功建立连接
 */
export function handleWakeUpgrade(
  req: IncomingMessage,
  res: ServerResponse
): boolean {
  const upgrade = req.headers['upgrade']?.toLowerCase() ?? '';

  if (upgrade !== 'websocket') {
    logger.warn('非 WebSocket 升级请求', { upgrade });
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('WebSocket Upgrade Required');
    return false;
  }

  const key = req.headers['sec-websocket-key'] as string;
  if (!key) {
    logger.warn('WebSocket 升级缺少 sec-websocket-key');
    res.writeHead(400);
    res.end();
    return false;
  }

  const acceptKey = generateAcceptKey(key);

  res.writeHead(101, {
    Upgrade: 'websocket',
    Connection: 'Upgrade',
    'Sec-WebSocket-Accept': acceptKey,
  });

  const rawSocket = res.socket as Socket | undefined;
  if (!rawSocket) {
    logger.warn('唤醒 WS 升级缺少底层 socket');
    res.end();
    return false;
  }

  rawSocket.setKeepAlive(true);
  rawSocket.setTimeout(0);

  const clientId = randomUUID();
  const client: WakeWsClient = {
    id: clientId,
    socket: rawSocket,
    state: ConnState.OPEN,
    connectedAt: Date.now(),
    missedPongs: 0,
    heartbeatTimer: null,
    closeHandler: null,
  };

  wakeClients.set(clientId, client);

  let dataBuffer: Buffer = Buffer.alloc(0);

  // P1-2.16: 在提取的 TraceContext 中注册消息监听，实现跨进程追踪
  withTraceContextFromRequest(req, () => {
    rawSocket.on('data', (data: Buffer) => {
      dataBuffer = Buffer.concat([dataBuffer, data]) as Buffer;
      dataBuffer = handleClientFrame(client, dataBuffer);
    });

    rawSocket.on('close', () => {
      if (client.state !== ConnState.CLOSED) {
        client.state = ConnState.CLOSED;
        stopHeartbeat(client);
        wakeClients.delete(clientId);
        client.closeHandler?.();
      }
    });

    rawSocket.on('error', (err) => {
      logger.error('唤醒 WS 连接错误', {
        clientId,
        error: err.message,
      });
      cleanupClient(client, 1011, 'internal error');
    });
  });

  // 启动心跳
  startHeartbeat(client);

  logger.info('唤醒 WS 客户端已连接', {
    clientId,
    activeCount: wakeClients.size,
  });

  return true;
}

/**
 * 广播唤醒词检测事件到所有连接的唤醒 WS 客户端
 * 由 VoiceWakeManager 在检测到唤醒词时调用
 *
 * @param detection 唤醒检测结果
 */
export function broadcastWakeEvent(detection: WakeDetectionResult): void {
  if (wakeClients.size === 0) return;

  const payload = JSON.stringify({
    type: 'wakeword_detected',
    timestamp: Date.now(),
    data: {
      detected: detection.detected,
      matchedTrigger: detection.matchedTrigger,
      remainingText: detection.remainingText,
    },
  });

  logger.info('广播唤醒事件', {
    trigger: detection.matchedTrigger,
    clientCount: wakeClients.size,
  });

  for (const [id, client] of wakeClients) {
    if (client.state !== ConnState.OPEN) {
      wakeClients.delete(id);
      continue;
    }
    sendTextFrame(client.socket, payload);
  }
}

/**
 * 关闭所有唤醒 WS 连接
 */
export function closeAllWakeConnections(): void {
  const count = wakeClients.size;
  logger.info('关闭所有唤醒 WS 连接', { count });

  for (const [_id, client] of wakeClients) {
    cleanupClient(client, 1001, 'server shutting down');
  }

  logger.info('所有唤醒 WS 连接已关闭', { count });
}
