/**
 * HTTP → WebSocket 升级工具
 * 使用 Node.js 内置 http + crypto + net 模块实现 RFC 6455
 */

import { Logger, LogLevel } from '@modules/monitoring';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';
import { createHash, randomUUID } from 'crypto';
import type {
  VoiceClientEvent,
  VoiceConnection,
  VoiceServerEvent,
} from './types';

const logger = new Logger({ level: LogLevel.INFO });

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

/** 客户端 WS 连接内部状态 */
interface InternalConnection {
  id: string;
  socket: Socket;
  state: ConnState;
  connectedAt: number;
  messageHandler: ((event: VoiceClientEvent) => void) | null;
  closeHandler: ((code: number, reason: string) => void) | null;
  errorHandler: ((error: Error) => void) | null;
  buffer: Buffer;
}

/**
 * 检测是否为 WebSocket 升级请求
 */
export function isWebSocketUpgrade(req: IncomingMessage): boolean {
  const upgrade = req.headers['upgrade']?.toLowerCase() ?? '';
  return upgrade === 'websocket';
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
 * 解析 WebSocket 帧
 */
export function parseFrame(
  buffer: Buffer
): { opcode: number; payload: Buffer; totalLength: number } | null {
  if (buffer.length < 2) return null;

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
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

  const maskSize = masked ? 4 : 0;
  const headerEnd = offset + maskSize;

  if (buffer.length < headerEnd + payloadLength) return null;

  let mask: Buffer | null = null;
  if (masked) {
    mask = buffer.subarray(offset, offset + 4);
  }

  let payload = buffer.subarray(headerEnd, headerEnd + payloadLength);

  if (mask) {
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }
  }

  return { opcode, payload, totalLength: headerEnd + payloadLength };
}

/**
 * 构建 WebSocket 帧（服务端→客户端，不掩码）
 */
export function buildFrame(opcode: number, payload: Buffer): Buffer {
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
 * 处理 WS 数据帧
 */
function handleDataFrame(conn: InternalConnection): void {
  let { buffer } = conn;

  while (buffer.length >= 2) {
    const frame = parseFrame(buffer);
    if (!frame) break;

    buffer = buffer.slice(frame.totalLength);

    switch (frame.opcode) {
      case OpCode.TEXT: {
        const text = frame.payload.toString('utf-8');
        try {
          const event = JSON.parse(text) as VoiceClientEvent;
          conn.messageHandler?.(event);
        } catch {
          logger.warn('无法解析 WebSocket 消息', { text: text.slice(0, 100) });
        }
        break;
      }

      case OpCode.CLOSE: {
        logger.info('WebSocket 收到关闭帧', { connId: conn.id });
        conn.state = ConnState.CLOSING;
        sendCloseFrame(conn);
        conn.socket.end();
        conn.state = ConnState.CLOSED;
        conn.closeHandler?.(1000, 'remote close');
        break;
      }

      case OpCode.PING: {
        sendPongFrame(conn, frame.payload);
        break;
      }

      case OpCode.PONG:
        break;
    }
  }

  conn.buffer = buffer;
}

/**
 * 发送文本帧
 */
function sendTextFrame(conn: InternalConnection, text: string): void {
  if (conn.state !== ConnState.OPEN) return;
  try {
    const payload = Buffer.from(text, 'utf-8');
    const frame = buildFrame(OpCode.TEXT, payload);
    conn.socket.write(frame);
  } catch {
    // 忽略发送错误
  }
}

/**
 * 发送关闭帧
 */
function sendCloseFrame(conn: InternalConnection): void {
  try {
    const frame = buildFrame(OpCode.CLOSE, Buffer.from([0x03, 0xe8]));
    conn.socket.write(frame);
  } catch {
    // 忽略关闭帧发送错误
  }
}

/**
 * 发送 Pong 帧
 */
function sendPongFrame(conn: InternalConnection, payload: Buffer): void {
  try {
    const frame = buildFrame(OpCode.PONG, payload);
    conn.socket.write(frame);
  } catch {
    // 忽略 pong 发送错误
  }
}

/**
 * 执行 HTTP → WebSocket 升级
 * @param req HTTP 请求
 * @param res HTTP 响应
 * @returns VoiceConnection 实例，升级失败返回 null
 */
export function upgradeToVoiceConnection(
  req: IncomingMessage,
  res: ServerResponse
): VoiceConnection | null {
  const key = req.headers['sec-websocket-key'] as string;
  if (!key) {
    logger.warn('WebSocket 升级缺少 sec-websocket-key');
    res.writeHead(400);
    res.end();
    return null;
  }

  const acceptKey = generateAcceptKey(key);

  res.writeHead(101, {
    Upgrade: 'websocket',
    Connection: 'Upgrade',
    'Sec-WebSocket-Accept': acceptKey,
  });

  const rawSocket = res.socket as Socket | undefined;
  if (!rawSocket) {
    logger.warn('WebSocket 升级缺少底层 socket');
    res.end();
    return null;
  }

  rawSocket.setKeepAlive(true);
  rawSocket.setTimeout(0);

  const conn: InternalConnection = {
    id: randomUUID(),
    socket: rawSocket,
    state: ConnState.OPEN,
    connectedAt: Date.now(),
    messageHandler: null,
    closeHandler: null,
    errorHandler: null,
    buffer: Buffer.alloc(0),
  };

  rawSocket.on('data', (data: Buffer) => {
    conn.buffer = Buffer.concat([conn.buffer, data]);
    handleDataFrame(conn);
  });

  rawSocket.on('close', () => {
    if (conn.state !== ConnState.CLOSED) {
      conn.state = ConnState.CLOSED;
      conn.closeHandler?.(1006, 'connection closed');
    }
  });

  rawSocket.on('error', (err) => {
    logger.error('WebSocket 连接错误', { connId: conn.id, error: err.message });
    conn.errorHandler?.(err);
  });

  logger.info('WebSocket 升级成功', { connId: conn.id });

  const connection: VoiceConnection = {
    id: conn.id,
    connectedAt: conn.connectedAt,

    send(event: VoiceServerEvent): void {
      sendTextFrame(conn, JSON.stringify(event));
    },

    onMessage(handler: (event: VoiceClientEvent) => void): void {
      conn.messageHandler = handler;
    },

    onClose(handler: (code: number, reason: string) => void): void {
      conn.closeHandler = handler;
    },

    onError(handler: (error: Error) => void): void {
      conn.errorHandler = handler;
    },

    close(code: number = 1000, reason: string = 'normal closure'): void {
      if (conn.state !== ConnState.OPEN) return;
      conn.state = ConnState.CLOSING;
      sendCloseFrame(conn);
      conn.socket.end();
      conn.state = ConnState.CLOSED;
      conn.closeHandler?.(code, reason);
    },
  };

  return connection;
}
