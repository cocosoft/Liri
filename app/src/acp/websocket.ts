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
 * WebSocket 协议工具（RFC 6455）
 *
 * 基于 Node.js 内置 crypto 模块实现 WebSocket 帧编码/解码，
 * 无需 ws 或 uws 等第三方依赖。
 */

import * as crypto from 'crypto';

/** RFC 6455 WebSocket 魔术 GUID */
export const MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** WebSocket 操作码 */
export const enum OpCode {
  CONTINUATION = 0x0,
  TEXT = 0x1,
  BINARY = 0x2,
  CLOSE = 0x8,
  PING = 0x9,
  PONG = 0xa,
}

/** 默认最大消息大小（1MB） */
export const DEFAULT_MAX_MESSAGE_SIZE = 1 * 1024 * 1024;

/**
 * WebSocket 帧解析结果
 */
export interface ParsedFrame {
  /** 帧操作码 */
  opcode: number;
  /** 帧负载 */
  payload: Buffer;
  /** 帧总长度（含头部） */
  totalLength: number;
  /** 是否设置了掩码 */
  masked: boolean;
}

/**
 * 计算 Sec-WebSocket-Accept 值
 */
export function computeAcceptHash(key: string): string {
  return crypto
    .createHash('sha1')
    .update(key + MAGIC_GUID)
    .digest('base64');
}

/**
 * 解析 WebSocket 帧
 *
 * 从 buffer 的 offset 位置尝试解析一个完整的 WebSocket 帧。
 * 如果数据不足，返回 null。
 *
 * @param buffer - 帧数据缓冲区
 * @param offset - 解析起始位置
 * @param maxMessageSize - 允许的最大消息大小（字节）
 * @returns 解析成功的帧信息，或 null（数据不足）
 */
export function parseWebSocketFrame(
  buffer: Buffer,
  offset: number,
  maxMessageSize: number = DEFAULT_MAX_MESSAGE_SIZE
): ParsedFrame | null {
  if (buffer.length - offset < 2) return null;

  const firstByte = buffer[offset];
  const secondByte = buffer[offset + 1];
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;
  let headerLength = 2;

  if (payloadLength === 126) {
    headerLength += 2;
    if (buffer.length - offset < headerLength) return null;
    payloadLength = buffer.readUInt16BE(offset + 2);
  } else if (payloadLength === 127) {
    headerLength += 8;
    if (buffer.length - offset < headerLength) return null;
    const bigLen = buffer.readBigUInt64BE(offset + 2);
    if (bigLen > BigInt(maxMessageSize)) return null;
    payloadLength = Number(bigLen);
  }

  if (payloadLength > maxMessageSize) return null;

  const maskLength = masked ? 4 : 0;
  const totalLength = headerLength + maskLength + payloadLength;

  if (buffer.length - offset < totalLength) return null;

  let maskKey: Buffer | null = null;
  let payloadOffset = offset + headerLength;

  if (masked) {
    maskKey = buffer.subarray(payloadOffset, payloadOffset + 4);
    payloadOffset += 4;
  }

  let payload = buffer.subarray(payloadOffset, payloadOffset + payloadLength);

  if (maskKey) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] = payload[i] ^ maskKey[i % 4];
    }
  }

  return { opcode, payload, totalLength, masked };
}

/**
 * 编码 WebSocket 帧（服务端→客户端，不掩码）
 *
 * @param opcode - 帧操作码
 * @param payload - 帧负载
 * @returns 编码后的完整帧数据
 */
export function encodeWebSocketFrame(opcode: number, payload: Buffer): Buffer {
  let header: Buffer;

  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  return Buffer.concat([header, payload]);
}
