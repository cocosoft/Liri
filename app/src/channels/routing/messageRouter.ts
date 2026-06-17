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
 * 统一消息路由入口
 *
 * 整合原有的两条消息路由路径（ChannelManager.routeMessage + lazyConnectChannels 内联），
 * 提供统一的帧验证、去重、会话管理、错误处理管线。
 *
 * 路由管线：
 *   [0] 端到端追踪开始 (GatewaySessionTracer.traceInbound)
 *   → ① 帧验证 → ② 去重检查 → ③ 共享会话写入
 *   → ④ 会话创建/复用 → ⑤ CoreAPI.chat() → ⑥ 出站回调 + 追踪完成
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '../../error/handleError';
import { claimMessage, releaseProcessing, finalizeMessage } from '../dedup/index';
import type { MessageContext } from '../types/IChannel';
import type { SessionSpanContext } from '../../ai/telemetry/SessionSpanTracer';

const logger = new Logger({ level: LogLevel.INFO, module: 'channels:routing' });

/** 消息大小上限（默认 1MB） */
const MAX_MESSAGE_SIZE = 1 * 1024 * 1024;

/** 消息去重 TTL（毫秒） */
const DEDUP_TTL_MS = 3000;

/** 内容级去重缓存：`channelId:content` → 时间戳
 *
 * QQ 等通道可能对同一条消息发送两个不同事件类型（如 AT_MESSAGE_CREATE + GROUP_AT_MESSAGE_CREATE），
 * 两者的 messageId 和 senderId 均不同，导致 messageId 级和 senderId+content 级去重均失效。
 * 此缓存仅基于 `channelId + 消息内容` 做短窗口去重，作为全局兜底。
 */
const contentDedupCache = new Map<string, number>();

/** 内容级去重窗口（毫秒）—— 60s，覆盖 LLM 响应时间，确保同一条消息的重复事件不会触发两次 AI 调用 */
const CONTENT_DEDUP_WINDOW_MS = 60000;

/** 路由结果 */
export interface RouteResult {
  valid: boolean;
  errorCode?: string;
  errorMessage?: string;
  response?: string;
}

/** 帧验证结果 */
export interface FrameValidationResult {
  valid: boolean;
  errors?: string[];
  errorCode?: string;
}

/** 路由选项 */
export interface RouteMessageOptions {
  /** CoreAPI 实例（必传） */
  coreAPI: {
    chat(params: {
      content: string;
      sessionId: string;
      metadata?: Record<string, unknown>;
    }): Promise<{ content: string }>;
  };
  /** 出站回调（处理完消息后的回复发送） */
  onOutbound?: (content: string, target: string) => Promise<void>;
  /** 通道名称（用于日志和追踪） */
  channelName?: string;
  /** 是否启用端到端追踪 */
  enableTracing?: boolean;
}

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

/**
 * 统一消息路由函数
 *
 * 替代 ChannelManager.routeMessage() 和 lazyConnectChannels 中的内联消息处理。
 * 新通道和旧通道均通过此函数路由入站消息，确保行为一致。
 *
 * @param message 入站消息上下文
 * @param options 路由选项
 * @returns 路由结果
 */
export async function routeChannelMessage(
  message: MessageContext,
  options: RouteMessageOptions
): Promise<RouteResult> {
  const { coreAPI, onOutbound, channelName = 'unknown', enableTracing = false } = options;

  logger.info('[TRACE] routeChannelMessage 入口', {
    channelName,
    messageId: message.messageId,
    senderId: message.senderId,
    conversationId: message.conversationId,
    contentLength: message.content?.length || 0,
    hasOnOutbound: !!onOutbound,
  });

  // [0] 端到端追踪开始
  let traceSpanContext: SessionSpanContext | null = null;
  if (enableTracing) {
    try {
      const { GatewaySessionTracer } = await import('../GatewaySessionTracer');
      const tracer = new GatewaySessionTracer({ enabled: true });
      const result = tracer.traceInbound(
        message,
        message.content?.length || 0
      );
      traceSpanContext = result.spanContext;
    } catch {
      // 追踪不可用时静默降级
    }
  }

  // ① 帧验证
  const validation = validateInboundFrame(message);
  if (!validation.valid) {
    logger.warning('消息验证失败', {
      channelName,
      messageId: message.messageId,
      errors: validation.errors,
    });
    return {
      valid: false,
      errorCode: validation.errorCode || 'INVALID_FRAME',
      errorMessage: validation.errors?.join('; ') || '消息格式无效',
    };
  }

  // ② 去重检查（messageId 级）
  const claimResult = claimMessage(message.messageId);
  if (claimResult === 'duplicate') {
    logger.info(`重复消息已跳过: ${message.messageId}`, { channelName });
    return { valid: true, response: 'duplicate_skipped' };
  }

  // ②-② 内容级去重检查（兜底：不同 messageId 但内容相同的重复事件）
  if (message.content) {
    const contentKey = `${message.channelId || channelName}:${message.content}`;
    const now = Date.now();
    const lastContentTime = contentDedupCache.get(contentKey);
    if (lastContentTime && now - lastContentTime < CONTENT_DEDUP_WINDOW_MS) {
      logger.info(`内容级去重命中: ${channelName}`, {
        contentKey: contentKey.slice(0, 100),
        ageMs: now - lastContentTime,
      });
      // 也释放 messageId 级别的锁
      releaseProcessing(message.messageId);
      return { valid: true, response: 'duplicate_skipped' };
    }
    contentDedupCache.set(contentKey, now);
    // 定期清理过期条目
    if (contentDedupCache.size > 1000) {
      for (const [key, time] of contentDedupCache) {
        if (now - time > CONTENT_DEDUP_WINDOW_MS) {
          contentDedupCache.delete(key);
        }
      }
    }
  }

  try {
    // ③ 共享会话写入
    try {
      const { getDIContainer } = await import('../../core/DIContainer');
      const { MessageType, MessageRole } = await import('../../session/types/Message');
      const container = getDIContainer();
      if (container.has('combinedSessionGateway')) {
        const combinedGateway = container.resolve<{
          sendMessage: (sessionId: string, msg: Record<string, unknown>) => Promise<void>;
        }>('combinedSessionGateway');
        if (typeof combinedGateway.sendMessage === 'function') {
          await combinedGateway.sendMessage('shared-context', {
            id: message.messageId,
            sessionId: 'shared-context',
            type: MessageType.USER,
            role: MessageRole.USER,
            content: message.content,
            timestamp: message.timestamp || Date.now(),
            metadata: {
              channel: channelName,
              sender: message.senderId,
            },
          });
        }
      }
    } catch (sessionError) {
      // @ignore-catch: 非关键路径，写入失败不影响主路由流程
      logger.warning('共享会话写入失败', {
        messageId: message.messageId,
        error: String(sessionError),
      });
    }

    // ④ 会话创建/复用 → ⑤ CoreAPI.chat()
    logger.info('[TRACE] routeChannelMessage 调用 CoreAPI.chat 开始', {
      messageId: message.messageId,
      sessionId: message.conversationId ?? message.senderId,
      contentLength: message.content.length,
    });

    const response = await coreAPI.chat({
      content: message.content,
      sessionId: message.conversationId ?? message.senderId,
      metadata: {
        channel: message.channelId || channelName,
        sender: message.senderId,
        messageType: message.messageType,
        isDirectMessage: message.isDirectMessage,
        rawPayload: message.rawPayload,
      },
    });

    logger.info('[TRACE] routeChannelMessage CoreAPI.chat 返回', {
      messageId: message.messageId,
      hasContent: !!response.content,
      responseLength: response.content?.length || 0,
    });

    // ⑥ 出站回调 + 追踪完成
    if (response.content && onOutbound) {
      logger.info('[TRACE] routeChannelMessage 调用 onOutbound 回调', {
        messageId: message.messageId,
        target: message.conversationId ?? message.senderId,
      });

      const target = message.conversationId ?? message.senderId;
      logger.info('[TRACE] routeChannelMessage onOutbound 开始执行', {
        messageId: message.messageId,
        target,
      });
      await onOutbound(response.content, target);
      logger.info('[TRACE] routeChannelMessage onOutbound 执行完成', {
        messageId: message.messageId,
        target,
      });
    }

    if (enableTracing && traceSpanContext?.isSampled) {
      try {
        const { GatewaySessionTracer } = await import('../GatewaySessionTracer');
        const tracer = new GatewaySessionTracer({ enabled: true });
        tracer.traceOutbound(
          traceSpanContext,
          message.channelId || channelName,
          response.content?.length || 0
        );
      } catch {
        // 追踪不可用时静默降级
      }
    }

    // 标记消息处理完成
    finalizeMessage(message.messageId, true);

    return { valid: true, response: response.content };
  } catch (error) {
    // 释放消息锁
    releaseProcessing(message.messageId);

    await handleError(error, {
      module: 'channels:routing',
      action: 'routeChannelMessage',
      context: { channelName, messageId: message.messageId },
    });
    throw error;
  }
}