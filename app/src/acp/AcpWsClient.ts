// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * ACP WebSocket 客户端连接包装
 *
 * 封装 WebSocket 客户端连接的生命周期管理，包括帧解析、消息分发、连接断开处理。
 */

import type { Duplex } from 'stream';
import * as net from 'net';
import { resolveLogger, type ILogger } from '@modules/core';
import { handleError } from '@modules/error/handleError';
import {
  OpCode,
  DEFAULT_MAX_MESSAGE_SIZE,
  parseWebSocketFrame,
  encodeWebSocketFrame,
} from './websocket.js';

const logger: ILogger = resolveLogger('acp');

/**
 * ACP 客户端消息结构
 */
export interface AcpClientMessage {
  type: string;
  requestId?: string;
  payload?: Record<string, unknown>;
}

/**
 * ACP WebSocket 客户端连接包装
 */
export class AcpWsClient {
  readonly id: string;
  private socket: net.Socket | Duplex;
  private onDisconnect: () => void;
  private messageHandlers: Array<(text: string) => void> = [];
  private maxMessageSize: number;

  constructor(
    id: string,
    socket: net.Socket | Duplex,
    onDisconnect: () => void
  ) {
    this.id = id;
    this.socket = socket;
    this.onDisconnect = onDisconnect;
    this.maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE;

    let buffer = Buffer.alloc(0);

    this.socket.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      this.processFrames(buffer, (remaining: Buffer) => {
        buffer = Buffer.from(remaining);
      });
    });

    this.socket.on('close', () => {
      this.onDisconnect();
    });

    this.socket.on('error', (err: Error) => {
      logger.warning(`[ACP] 客户端异常: ${this.id}`, err);
    });
  }

  /**
   * 设置最大消息大小（字节）
   */
  setMaxMessageSize(size: number): void {
    this.maxMessageSize = size;
  }

  /**
   * 注册消息处理器
   */
  onMessage(handler: (text: string) => void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * 注册断开处理器
   */
  onClose(handler: () => void): void {
    this.socket.on('close', () => {
      handler();
    });
  }

  /**
   * 发送文本消息（WebSocket 帧编码）
   */
  send(text: string): void {
    if (this.socket.destroyed) return;

    const payload = Buffer.from(text, 'utf-8');
    const frame = encodeWebSocketFrame(OpCode.TEXT, payload);

    try {
      this.socket.write(frame);
    } catch (_err) {
      void handleError(
        _err instanceof Error ? _err : new Error('WebSocket send failed'),
        { module: 'acp:wsclient', action: 'send' }
      );
      this.socket.destroy();
    }
  }

  /**
   * 关闭连接
   */
  close(code?: number, reason?: string): void {
    if (this.socket.destroyed) return;

    const closePayload = Buffer.alloc(
      2 + (reason ? Buffer.byteLength(reason, 'utf-8') : 0)
    );
    closePayload.writeUInt16BE(code || 1000, 0);
    if (reason) {
      closePayload.write(reason, 2, 'utf-8');
    }

    try {
      this.socket.write(encodeWebSocketFrame(OpCode.CLOSE, closePayload));
    } catch (_err) {
      void handleError(
        _err instanceof Error ? _err : new Error('WebSocket close failed'),
        { module: 'acp:wsclient', action: 'close' }
      );
    }

    this.socket.end();
    this.socket.destroy();
  }

  /**
   * 解析并处理缓冲区中的 WebSocket 帧
   */
  private processFrames(
    buffer: Buffer,
    onRemaining: (remaining: Buffer) => void
  ): void {
    let offset = 0;

    while (offset < buffer.length) {
      const frame = parseWebSocketFrame(buffer, offset, this.maxMessageSize);
      if (!frame) break;

      const { opcode, payload, totalLength } = frame;

      if (opcode === OpCode.TEXT) {
        const text = payload.toString('utf-8');
        for (const handler of this.messageHandlers) {
          handler(text);
        }
      } else if (opcode === OpCode.CLOSE) {
        this.socket.end();
        this.socket.destroy();
        return;
      } else if (opcode === OpCode.PING) {
        this.socket.write(encodeWebSocketFrame(OpCode.PONG, payload));
      }

      offset += totalLength;
    }

    onRemaining(buffer.subarray(offset));
  }
}
