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

import { getLogger } from '@modules/monitoring';
import { getOTelTracing } from '../../monitoring/otel/OTelTracing.js';
import {
  recordInboundMessage,
  recordMessageProcessing,
  recordMessageRejected,
} from '../monitoring/ChannelMetrics.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '../../error/handleError';
import {
  claimMessage,
  releaseProcessing,
  finalizeMessage,
  markMessageProcessed,
} from '../dedup/index';
import type { MessageContext } from '../types/IChannel';
import type { SessionSpanContext } from '../../ai/telemetry/SessionSpanTracer';
import { channelSessionManager } from '../session/ChannelSessionManager';
import { isBridgeEnabled } from '../setupChannels';
// 2026-08-06 接入（P0-2）：DM 策略授权引擎（pairing/allowlist/open）
import { DmPolicyEngine } from '../policy/DmPolicy';
import type { DmPolicyConfig } from '../policy/DmPolicy';
// 2026-08-06 接入（P1-5）：渠道入站限流（按渠道+sender 令牌桶）
import { checkRateLimit } from './rateLimiter';

const logger = getLogger('channels:routing');

/** 消息大小上限（默认 1MB） */
const MAX_MESSAGE_SIZE = 1 * 1024 * 1024;

/** 消息去重 TTL（毫秒） */
const DEDUP_TTL_MS = 3000;

/** 内容级去重缓存：`channelId:content` → 时间戳
 *
 * QQ 等通道可能对同一条消息发送两个不同事件类型（如 AT_MESSAGE_CREATE + GROUP_AT_MESSAGE_CREATE），
 * 两者的 messageId 和 senderId 均不同，导致 messageId 级和 senderId+content 级去重均失效。
 * 此缓存仅基于 `channelId + 消息内容` 做短窗口去重，作为全局兜底。
 * 上限 10000 条，通过 setInterval 每 30s 清理过期条目防止 OOM。
 */
const contentDedupCache = new Map<string, number>();

/** 内容级去重窗口（毫秒）—— 5s，覆盖 WebSocket 重传窗口 */
const CONTENT_DEDUP_WINDOW_MS = 5000; // 5 秒内容去重窗口

/** AI 调用超时（毫秒）—— 防止渠道连接因长时间等待 LLM 而超时断开 */
const CHAT_TIMEOUT_MS = 120_000; // 2 分钟

/** 定期清理过期去重缓存条目 */
setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [key, time] of contentDedupCache) {
    if (now - time > CONTENT_DEDUP_WINDOW_MS * 2) {
      contentDedupCache.delete(key);
      removed++;
    }
  }
  // R08-002: 清理循环记录（skip=无需清理）
  if (removed > 0) {
    logger.debug('内容去重缓存清理', {
      removed,
      remaining: contentDedupCache.size,
    });
  }
}, 30000).unref();

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
    }): Promise<{ content: string; finishReason?: string }>;
  };
  /** 出站回调（处理完消息后的回复发送） */
  onOutbound?: (content: string, target: string) => Promise<void>;
  /** 通道名称（用于日志和追踪） */
  channelName?: string;
  /** 是否启用端到端追踪 */
  enableTracing?: boolean;
  /** 2026-08-06 新增（P0-2）：DM 策略配置（pairing/allowlist/open），提供则执行授权检查 */
  dmPolicy?: Partial<DmPolicyConfig>;
}

/**
 * Per-conversation 串行队列（DEEP-6 修复）
 *
 * 同会话内多条消息按到达顺序串行处理，避免 LLM 并发导致回复乱序。
 * key = channel:conversationId（DM 下 conversationId=senderId，天然隔离）。
 */
const sessionQueues = new Map<string, Promise<void>>();

/**
 * 按会话 key 串行执行 fn
 * 前一条完成后再执行下一条，保证同会话内回复顺序与消息到达顺序一致。
 */
async function runSerialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  sessionQueues.set(key, next);
  try {
    return await prev.then(fn);
  } finally {
    release();
    // 若队列已空（当前就是队尾）则清理，防止 Map 无限增长
    if (sessionQueues.get(key) === next) {
      sessionQueues.delete(key);
    }
  }
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
  const {
    coreAPI,
    onOutbound,
    channelName = 'unknown',
    enableTracing = false,
  } = options;

  const otel = getOTelTracing();
  const routeSpan = otel.startSpan('channel.routeMessage', {
    'channel.name': channelName,
    'message.id': message.messageId,
  });

  logger.info('[TRACE] routeChannelMessage 入口', {
    channelName,
    messageId: message.messageId,
    senderId: message.senderId,
    conversationId: message.conversationId,
    contentLength: message.content?.length || 0,
    hasOnOutbound: !!onOutbound,
  });

  // 可观测性（指标）：入站计数 + 处理耗时起点
  const processingStartMs = Date.now();
  recordInboundMessage();

  // [0] 生成全链路 traceId
  const traceId = `ch_trc_${channelName}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // [0.5] 端到端追踪开始
  let traceSpanContext: SessionSpanContext | null = null;
  if (enableTracing) {
    try {
      const { GatewaySessionTracer } = await import('../GatewaySessionTracer');
      const tracer = new GatewaySessionTracer({ enabled: true });
      const result = tracer.traceInbound(message, message.content?.length || 0);
      traceSpanContext = result.spanContext;
    } catch (err) {
      // @ignore-catch — 追踪不可用，静默降级（非关键路径）
      logger.debug('GatewaySessionTracer inbound trace skipped', {
        error: String(err),
      });
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
    recordMessageRejected(validation.errorCode || 'INVALID_FRAME');
    otel.endSpan(routeSpan);
    return {
      valid: false,
      errorCode: validation.errorCode || 'INVALID_FRAME',
      errorMessage: validation.errors?.join('; ') || '消息格式无效',
    };
  }

  // ①-② DM 策略授权（2026-08-06 接入，P0-2）：
  // 各渠道 security.dmPolicy（pairing/allowlist/open）由调用方经 options.dmPolicy 传入，
  // 未授权消息在进入去重/会话/LLM 链路前即被拦截。
  if (options.dmPolicy) {
    const dmEngine = new DmPolicyEngine(options.dmPolicy);
    const authResult = await dmEngine.authorize(message);
    if (!authResult.allowed) {
      logger.warning('消息未通过 DM 策略授权', {
        channelName,
        senderId: message.senderId,
        reason: authResult.reason,
      });
      recordMessageRejected('UNAUTHORIZED');
      otel.endSpan(routeSpan);
      return {
        valid: false,
        errorCode: 'UNAUTHORIZED',
        errorMessage: authResult.reason || '发送者未获授权',
      };
    }
  }

  // ② 去重检查（messageId 级）——先于限流，避免重复事件浪费限流额度（BUG-4）
  const claimResult = claimMessage(message.messageId);
  if (claimResult === 'duplicate') {
    logger.info(`重复消息已跳过: ${message.messageId}`, { channelName });
    recordMessageRejected('duplicate');
    otel.endSpan(routeSpan);
    return { valid: true, response: 'duplicate_skipped' };
  }
  if (claimResult === 'inflight') {
    logger.info(`消息正在处理中: ${message.messageId}`, { channelName });
    recordMessageRejected('inflight');
    otel.endSpan(routeSpan);
    return { valid: true, response: 'inflight_skipped' };
  }
  if (claimResult === 'invalid') {
    recordMessageRejected('INVALID_ID');
    otel.endSpan(routeSpan);
    return { valid: false, errorCode: 'INVALID_ID' };
  }

  // ②-② 内容级去重检查（兜底：不同 messageId 但内容相同的重复事件）
  if (message.content) {
    // DEEP-7：内容去重 key 增加 senderId 维度，避免误杀不同用户发送的相同内容
    const contentKey = `${message.channelId || channelName}:${message.senderId}:${message.content}`;
    const now = Date.now();
    const lastContentTime = contentDedupCache.get(contentKey);
    if (lastContentTime && now - lastContentTime < CONTENT_DEDUP_WINDOW_MS) {
      logger.info(`内容级去重命中: ${channelName}`, {
        contentKey: contentKey.slice(0, 100),
        ageMs: now - lastContentTime,
      });
      // 也释放 messageId 级别的锁
      releaseProcessing(message.messageId);
      recordMessageRejected('content_dedup');
      otel.endSpan(routeSpan);
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

  // ②-③ 入站限流（2026-08-06 接入，P1-5）：按渠道+sender 令牌桶，
  // 超限直接拒绝（不触发 LLM 调用），防止 open 渠道被刷爆成本
  if (!checkRateLimit(channelName, message.senderId)) {
    logger.warning('消息触发限流', {
      channelName,
      senderId: message.senderId,
    });
    // P1-1：claimMessage 已持锁，限流拒绝路径必须释放锁，
    // 否则该 messageId 永久残留 inflight 集合，渠道重传被无限拦截
    releaseProcessing(message.messageId);
    recordMessageRejected('RATE_LIMITED');
    otel.endSpan(routeSpan);
    return {
      valid: false,
      errorCode: 'RATE_LIMITED',
      errorMessage: '发送过于频繁，请稍后再试',
    };
  }

  try {
    // ③ 共享会话写入
    try {
      const { getDIContainer } = await import('../../core/DIContainer');
      const { MessageType, MessageRole } =
        await import('../../session/types/Message');
      const container = getDIContainer();
      if (container.has('combinedSessionGateway')) {
        const combinedGateway = container.resolve<{
          sendMessage: (
            sessionId: string,
            msg: Record<string, unknown>
          ) => Promise<void>;
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

    // DEEP-12：群聊场景下 conversationId 是群 ID，所有用户共享会导致上下文互相污染
    // 非 DM 消息时在会话键中注入 senderId 区分不同用户
    const sessionKey = message.isDirectMessage
      ? (message.conversationId ?? message.senderId)
      : `${message.conversationId ?? message.senderId}:${message.senderId}`;

    // ④ 会话创建/复用 → ⑤ CoreAPI.chat()
    logger.info('[TRACE] routeChannelMessage 调用 CoreAPI.chat 开始', {
      messageId: message.messageId,
      sessionId: sessionKey,
      contentLength: message.content.length,
    });

    // 创建/复用渠道会话，为 Inbox 桥接提供 channelSessionId
    const channelSession = isBridgeEnabled()
      ? channelSessionManager.getOrCreate(
          (message.channelId ||
            channelName) as import('../types/IChannel').ChannelId,
          message.conversationId ?? message.senderId,
          message.senderId,
          message.senderName
        )
      : null;

    // ── 纯文本审批前置检查：如果当前会话有 pending Inbox 项，检测审批关键词 ──
    if (isBridgeEnabled() && channelSession && message.content) {
      try {
        const { detectApprovalIntent, processTextApproval } =
          await import('../bridge/TextApprovalParser.js');
        const intent = detectApprovalIntent(message.content);
        if (intent) {
          const items = await channelSessionManager.getInboxItemIds(
            channelSession.id
          );
          if (items.length > 0) {
            const { inboxManager } =
              await import('@modules/runtime/InboxManager.js');
            for (const itemId of items) {
              const item = await inboxManager.get(itemId);
              if (item && item.status === 'pending') {
                try {
                  // ── fail-closed: Inbox 写入失败时拒绝放行 ──
                  const processed = await processTextApproval(itemId, intent);
                  if (processed && onOutbound) {
                    const replyText =
                      intent === 'approve'
                        ? `已批准「${item.title}」`
                        : `已拒绝「${item.title}」`;
                    await onOutbound(
                      replyText,
                      message.conversationId ?? message.senderId
                    );
                  }
                  // DEEP-9：释放 claimMessage 锁，防止 messageId 永久 inflight
                  finalizeMessage(message.messageId, true);
                  otel.endSpan(routeSpan);
                  return { valid: true, response: 'text_approval_processed' };
                } catch (inboxErr) {
                  await handleError(inboxErr, {
                    module: 'channels:routing',
                    action: 'textApproval:inboxWrite',
                    context: { itemId, intent, traceId },
                  });
                  if (onOutbound) {
                    await onOutbound(
                      '系统繁忙，请稍后再试',
                      message.conversationId ?? message.senderId
                    );
                  }
                  // DEEP-9：即使失败也要释放锁
                  finalizeMessage(message.messageId, true);
                  recordMessageRejected('INBOX_UNAVAILABLE');
                  otel.endSpan(routeSpan);
                  return { valid: false, errorCode: 'INBOX_UNAVAILABLE' };
                }
              }
            }
          }
        }
      } catch (preCheckErr) {
        // @ignore-catch: 审批预检失败（导入失败等非关键错误）不阻塞主路由
        await handleError(preCheckErr, {
          module: 'channels:routing',
          action: 'textApproval:preCheck',
          context: { channelName, messageId: message.messageId },
        });
      }
    }

    // DEEP-6：per-session 串行化，保证同会话回复顺序不乱
    // DEEP-12：串行 key 与 CoreAPI 会话键一致（群聊按用户隔离）
    const serializedKey = `${channelName}:${sessionKey}`;
    const response = await runSerialized(serializedKey, async () => {
      const chatPromise = coreAPI.chat({
        content: message.content,
        sessionId: sessionKey,
        metadata: {
          channel: message.channelId || channelName,
          sender: message.senderId,
          messageType: message.messageType,
          isDirectMessage: message.isDirectMessage,
          traceId,
          channelSessionId: channelSession?.id,
          channelConversationId: channelSession?.conversationId,
          rawPayload: message.rawPayload,
        },
      });
      // DEEP-14：超时 timer 可取消
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () =>
            reject(
              new Error(`CoreAPI.chat() 超时 (>${CHAT_TIMEOUT_MS / 1000}s)`)
            ),
          CHAT_TIMEOUT_MS
        );
      });
      const result = await Promise.race([chatPromise, timeoutPromise]);
      clearTimeout(timeoutHandle);
      return result;
    });

    logger.info('[TRACE] routeChannelMessage CoreAPI.chat 返回', {
      messageId: message.messageId,
      hasContent: !!response.content,
      responseLength: response.content?.length || 0,
      finishReason: (response as Record<string, unknown>).finishReason,
    });

    // DEEP-5：CoreAPI 返回 error 时，消息不应标记为已处理（否则 LLM 错误后渠道重传同一消息被丢弃）
    const finishReason = (response as Record<string, unknown>).finishReason;
    if (finishReason === 'error') {
      logger.warning(
        'CoreAPI.chat 返回 error finishReason，释放消息锁但不标记已处理',
        {
          messageId: message.messageId,
          channelName,
        }
      );
      releaseProcessing(message.messageId);
      recordMessageRejected('LLM_ERROR');
      recordMessageProcessing(channelName, Date.now() - processingStartMs);
      otel.endSpan(routeSpan);
      return {
        valid: false,
        errorCode: 'LLM_ERROR',
        errorMessage: '消息处理失败，请稍后重试',
      };
    }

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
        const { GatewaySessionTracer } =
          await import('../GatewaySessionTracer');
        const tracer = new GatewaySessionTracer({ enabled: true });
        tracer.traceOutbound(
          traceSpanContext,
          message.channelId || channelName,
          response.content?.length || 0
        );
      } catch (err) {
        // @ignore-catch — 追踪不可用，静默降级（非关键路径）
        logger.debug('GatewaySessionTracer outbound trace skipped', {
          error: String(err),
        });
      }
    }

    // 标记消息处理完成
    finalizeMessage(message.messageId, true);

    recordMessageProcessing(channelName, Date.now() - processingStartMs);
    otel.endSpan(routeSpan);
    return { valid: true, response: response.content };
  } catch (error) {
    // 释放消息锁
    releaseProcessing(message.messageId);

    // BUG-5：超时后补标记 processed，防止渠道重传同一消息导致重复处理
    // （LLM 请求超时≠请求失败，重传会再次触发 LLM 调用造成重复计费）
    const isTimeout =
      error instanceof Error &&
      error.message.includes(`超时 (>${CHAT_TIMEOUT_MS / 1000}s)`);
    if (isTimeout) {
      markMessageProcessed(message.messageId);
      logger.warning(
        'CoreAPI.chat 超时，消息标记为已处理（避免重传重复计费）',
        {
          messageId: message.messageId,
          channelName,
        }
      );
    }

    otel.recordError(
      routeSpan,
      error instanceof Error ? error : new Error(String(error))
    );
    recordMessageProcessing(channelName, Date.now() - processingStartMs);
    otel.endSpan(routeSpan);
    await handleError(error, {
      module: 'channels:routing',
      action: 'routeChannelMessage',
      context: { channelName, messageId: message.messageId },
    });
    throw error;
  }
}
