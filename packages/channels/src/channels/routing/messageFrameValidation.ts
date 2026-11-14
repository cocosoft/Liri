// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 入站帧验证（自 `messageRouter.ts` **纯搬迁**，2026-10-09 C3-S3）。
// 由 `messageRouter.ts` 重导出以保持对外 API 不变。

import type { MessageContext } from '../types/IChannel';
import { MAX_MESSAGE_SIZE } from './messageRouterContract';
import type { FrameValidationResult } from './messageRouterContract';

/**
 * 验证入站消息帧的合法性
 * 提供 6 项验证规则：空ID、空发送者、无效时间戳、未来时间戳、超大消息体、控制字符
 */
export function validateInboundFrame(
  message: MessageContext
): FrameValidationResult {
  const errors: string[] = [];

  // 规则 1：消息 ID 不能为空
  if (!message.messageId || typeof message.messageId !== 'string') {
    errors.push('消息 ID 不能为空');
    return { valid: false, errors, errorCode: 'INVALID_ID' };
  }

  // 规则 2：发送者不能为空
  if (!message.senderId || typeof message.senderId !== 'string') {
    errors.push('消息发送者不能为空');
    return { valid: false, errors, errorCode: 'INVALID_SENDER' };
  }

  // 规则 3：时间戳必须有效
  const now = Date.now();
  if (
    message.timestamp &&
    typeof message.timestamp === 'number' &&
    message.timestamp > 0
  ) {
    // 规则 4：时间戳不能是未来时间（超过 5 分钟偏差视为未来）
    if (message.timestamp > now + 5 * 60 * 1000) {
      errors.push('消息时间戳为未来时间');
      return { valid: false, errors, errorCode: 'INVALID_TIMESTAMP' };
    }
  }

  // 规则 5：消息体大小检查（默认 1MB）
  if (message.content && message.content.length > MAX_MESSAGE_SIZE) {
    errors.push(`消息体超过大小上限 (${MAX_MESSAGE_SIZE} bytes)`);
    return { valid: false, errors, errorCode: 'MESSAGE_TOO_LARGE' };
  }

  // 规则 6：控制字符检查
  if (message.content && /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(message.content)) {
    errors.push('消息包含非法控制字符');
    return { valid: false, errors, errorCode: 'INVALID_CHARACTER' };
  }

  return { valid: true };
}
