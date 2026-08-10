/**
 * Edge TTS WebSocket Transport
 *
 * 提供底层 WebSocket 客户端实现：握手、帧编解码、心跳。
 * 使用 Node.js 原生 tls/crypto 模块，无第三方依赖。
 *
 * 职责分离：
 *   - 本模块只负责 WebSocket 协议层的连接管理
 *   - EdgeTTSProvider 负责业务逻辑（SSML 构建、音频提取）
 */

import { connect as tlsConnect, TLSSocket } from 'tls';
import { createHash, randomUUID } from 'crypto';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('voice:edgeTTS:transport');

/** WebSocket GUID（RFC 6455） */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** WebSocket 操作码 */
export const enum WsOpcode {
  CONTINUATION = 0x0,
  TEXT = 0x1,
  BINARY = 0x2,
  CLOSE = 0x8,
  PING = 0x9,
  PONG = 0xa,
}

/** WebSocket 连接上下文 */
export interface WsConnection {
  socket: TLSSocket;
  onText: (data: Buffer) => void;
  onBinary: (data: Buffer) => void;
  onClose: () => void;
  onError: (error: Error) => void;
}

/** 连接配置 */
export interface EdgeTTSTransportConfig {
  host: string;
  path: string;
  port: number;
  /** User-Agent 头 */
  userAgent?: string;
  /** Origin 头 */
  origin?: string;
  /** Cookie 头值 */
  cookie?: string;
}

/**
 * 生成 WebSocket 握手密钥
 */
function generateWsKey(): string {
  const key = randomUUID().replace(/-/g, '').slice(0, 16);
  return Buffer.from(key).toString('base64');
}

/**
 * 计算 WebSocket 握手 accept 值
 */
function computeWsAccept(key: string): string {
  const hash = createHash('sha1')
    .update(key + WS_GUID)
    .digest();
  return hash.toString('base64');
}

/**
 * 发送 WebSocket 帧
 *
 * 支持三种帧大小：
 *   - 小帧（< 126 字节）：2 字节头
 *   - 中帧（126 ~ 65535 字节）：4 字节头
 *   - 大帧（> 65535 字节）：10 字节头
 *
 * 客户端帧始终带掩码（mask=1）。
 */
export function sendWsFrame(
  conn: WsConnection,
  opcode: number,
  payload: Buffer
): void {
  const maskKey = Buffer.from(
    randomUUID().replace(/-/g, '').slice(0, 4),
    'utf8'
  );
  const payloadLength = payload.length;

  let header: Buffer;

  if (payloadLength < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | payloadLength;
  } else if (payloadLength < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payloadLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payloadLength), 2);
  }

  const maskedPayload = Buffer.alloc(payloadLength);
  for (let i = 0; i < payloadLength; i++) {
    maskedPayload[i] = payload[i] ^ maskKey[i % 4];
  }

  conn.socket.write(Buffer.concat([header, maskKey, maskedPayload]));
}

/**
 * 处理接收到的 WebSocket 帧
 *
 * 解析帧头 → 去掩码 → 按操作码分发给回调。
 * 缓冲区中不完整的帧会被保留，等后续数据到达后继续解析。
 */
function processWsFrames(
  conn: WsConnection,
  buffer: Buffer,
  onConsumed: (remaining: Buffer) => void
): void {
  let offset = 0;

  while (offset < buffer.length) {
    if (buffer.length - offset < 2) break;

    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let headerLen = 2;

    if (payloadLength === 126) {
      if (buffer.length - offset < 4) break;
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLength === 127) {
      if (buffer.length - offset < 10) break;
      payloadLength = Number(buffer.readBigUInt64BE(offset + 2));
      headerLen = 10;
    }

    const maskLen = masked ? 4 : 0;
    const totalLen = headerLen + maskLen + payloadLength;

    if (buffer.length - offset < totalLen) break;

    let maskKey: Buffer | null = null;
    let payloadStart = offset + headerLen;

    if (masked) {
      maskKey = buffer.slice(payloadStart, payloadStart + 4);
      payloadStart += 4;
    }

    let payload = Buffer.from(
      buffer.slice(payloadStart, payloadStart + payloadLength)
    );

    if (maskKey) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] = payload[i] ^ maskKey[i % 4];
      }
    }

    switch (opcode) {
      case WsOpcode.TEXT:
        conn.onText(payload);
        break;

      case WsOpcode.BINARY:
        conn.onBinary(payload);
        break;

      case WsOpcode.CLOSE:
        conn.socket.end();
        return;

      case WsOpcode.PING:
        sendWsFrame(conn, WsOpcode.PONG, Buffer.alloc(0));
        break;

      case WsOpcode.PONG:
        // pong 帧静默忽略
        break;
    }

    offset += totalLen;
  }

  onConsumed(buffer.slice(offset));
}

/**
 * 执行 WebSocket 握手并建立连接
 *
 * 握手流程：
 *   1. TLS 连接目标服务器
 *   2. 发送 HTTP Upgrade 请求（含 Sec-WebSocket-Key）
 *   3. 验证 101 响应 + Sec-WebSocket-Accept
 *   4. 设置帧解析管线
 *
 * @param config 连接配置
 * @returns WebSocket 连接上下文
 */
export function wsConnect(
  config: EdgeTTSTransportConfig
): Promise<WsConnection> {
  return new Promise((resolve, reject) => {
    const key = generateWsKey();

    const handshakeLines = [
      `GET ${config.path} HTTP/1.1`,
      `Host: ${config.host}:${config.port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Pragma: no-cache',
      'Cache-Control: no-cache',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      'Accept-Encoding: gzip, deflate, br, zstd',
      'Accept-Language: en-US,en;q=0.9',
      config.userAgent || 'Mozilla/5.0',
      config.origin || 'chrome-extension://default',
      config.cookie ? `Cookie: ${config.cookie}` : '',
      '',
      '',
    ].join('\r\n');

    const socket = tlsConnect(config.port, config.host, {
      servername: config.host,
    });

    let handshakeComplete = false;
    let responseBuffer = '';

    socket.on('data', (data) => {
      if (handshakeComplete) return;

      responseBuffer += data.toString();

      const headerEnd = responseBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const headers = responseBuffer.slice(0, headerEnd);
      handshakeComplete = true;

      // 验证 HTTP 状态码
      const statusLine = headers.split('\r\n')[0] || '';
      const statusMatch = statusLine.match(/HTTP\/\d+\.\d+\s+(\d+)/);
      const httpStatus = statusMatch ? parseInt(statusMatch[1], 10) : 0;

      if (httpStatus !== 101) {
        socket.destroy();
        const reason = headers.split('\r\n').slice(0, 3).join(' | ');
        reject(
          new Error(
            `WebSocket 握手失败: 服务器返回 ${httpStatus}（预期 101），响应: ${reason}`
          )
        );
        return;
      }

      // 验证 Sec-WebSocket-Accept
      const acceptMatch = headers.match(/Sec-WebSocket-Accept:\s*(\S+)/i);
      if (!acceptMatch) {
        socket.destroy();
        reject(new Error('WebSocket 握手失败: 缺少 Sec-WebSocket-Accept'));
        return;
      }

      const expectedAccept = computeWsAccept(key);
      if (acceptMatch[1] !== expectedAccept) {
        socket.destroy();
        reject(new Error('WebSocket 握手失败: Sec-WebSocket-Accept 不匹配'));
        return;
      }

      const conn: WsConnection = {
        socket,
        onText: () => {},
        onBinary: () => {},
        onClose: () => {},
        onError: () => {},
      };

      // 帧解析管线
      let frameBuffer: Buffer = Buffer.from(
        responseBuffer.slice(headerEnd + 4)
      );

      socket.on('data', (frameData) => {
        frameBuffer = Buffer.concat([frameBuffer, frameData]);
        processWsFrames(conn, frameBuffer, (remaining) => {
          frameBuffer = remaining;
        });
      });

      socket.on('close', () => {
        conn.onClose();
      });

      socket.on('error', (error) => {
        conn.onError(error);
      });

      logger.debug('WebSocket 握手成功', { host: config.host });

      resolve(conn);
    });

    socket.on('error', (error) => {
      logger.warn('TLS 连接错误', { host: config.host, error: String(error) });
      reject(error);
    });

    socket.write(handshakeLines);
  });
}

/**
 * 启动 WebSocket 心跳保活
 *
 * 每 15 秒发送 PING 帧，保持长连接不被中间代理断开。
 * 如果 socket 不可写入则自动停止。
 *
 * @param conn WebSocket 连接
 * @param onStop 停止回调（用于清理定时器引用）
 * @returns 可取消的定时器句柄
 */
export function startHeartbeat(
  conn: WsConnection
): ReturnType<typeof setInterval> {
  const interval = setInterval(() => {
    try {
      if (conn.socket && conn.socket.writable) {
        sendWsFrame(conn, WsOpcode.PING, Buffer.alloc(0));
      } else {
        clearInterval(interval);
      }
    } catch (err) {
      clearInterval(interval);
    }
  }, 15_000);

  return interval;
}

/**
 * 优雅关闭连接
 *
 * 发送 CLOSE 帧后销毁 socket。
 */
export function closeConnection(conn: WsConnection): void {
  try {
    sendWsFrame(conn, WsOpcode.CLOSE, Buffer.alloc(0));
  } catch (err) {
    // 关闭帧发送失败，直接销毁
  }
  try {
    conn.socket.destroy();
  } catch (err) {
    // socket 可能已经被销毁
  }
}
