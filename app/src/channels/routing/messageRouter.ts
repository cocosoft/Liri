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
 *   → ④ 会话创建/复用 → ⑤ CoreAPI.chatStream()（流式并轨 2026-08-20）→ ⑥ 出站回调 + 追踪完成
 */

import { getLogger } from '@modules/monitoring';
import { getOTelTracing } from '../../monitoring/otel/OTelTracing.js';
import { messageTraceBuffer } from '../monitoring/MessageTraceBuffer';
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
import type { SessionSpanContext } from '@modules/ai';
import { channelSessionManager } from '../session/ChannelSessionManager';
import { isBridgeEnabled } from '../setupChannels';
// 2026-08-06 接入（P0-2）：DM 策略授权引擎（pairing/allowlist/open）
import { DmPolicyEngine } from '../policy/DmPolicy';
import type { DmPolicyConfig } from '../policy/DmPolicy';
// 2026-08-06 接入（P1-5）：渠道入站限流（按渠道+sender 令牌桶）
import { checkRateLimit } from './rateLimiter';
// 2026-08-20 流式并轨：渠道消息改走 chatStream 流式轨道（与 client 同管线）
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI';
// 2026-08-20 工具进度通知人话文案（替代裸工具名）
import { formatToolNotifySummary } from './toolNotifySummary';
// 2026-08-20 spec qq-file-transfer：出站文件路由
import { sendOutboundFiles } from './outboundFileRouter';

const logger = getLogger('channels:routing');

/**
 * Windows 兼容：会话 ID 可能含文件系统非法字符（如 QQ 的 "c2c:{openid}"、
 * 群聊的 "group:{gid}:{uid}"），直接作为持久化目录名会导致 mkdir ENOTDIR
 * 失败（会话创建失败 → chat 报错 → 渠道无回复）。统一替换为 '_'
 * （确定性映射，同一用户/会话每次生成相同 ID，会话复用不受影响）。
 */
function sanitizeSessionId(id: string): string {
  return id.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
}

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
const CHAT_TIMEOUT_MS = 120_000; // 2 分钟（历史值，见 STREAM_IDLE_TIMEOUT_MS）
/**
 * 流式并轨（2026-08-20）：渠道 chatStream 空转超时。
 * 语义变更：原非流式路径为"绝对 2 分钟"超时（长程任务被硬掐）；流式轨道改为
 * "活动心跳超时"——只要流持续产出 chunk（长任务工具执行期间会周期产出
 * status/tool_call chunk）就不掐断，仅当连续本时长无任何 chunk 才判定卡死。
 * 长度需覆盖单个慢工具的静默期（如大目录搜索），故取 5 分钟。
 */
const STREAM_IDLE_TIMEOUT_MS = 300_000;
/**
 * AC-5③（2026-08-20）：长任务占位提示阈值。QQ 等渠道被动回复窗口约 5 分钟，
 * 任务超窗后最终回复会被渠道拒收；超过本阈值仍未完成时先推送一条占位提示
 * （走一次被动回复，msg_seq 由渠道侧递增管理），最终结果超窗时由渠道侧
 * 降级主动消息送达。
 */
const LONG_TASK_PLACEHOLDER_AFTER_MS = 240_000; // 4 分钟（留 1 分钟窗口余量）

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
    /** 流式并轨（2026-08-20）：渠道消息主路径，与 client /v1/chat/stream 同管线 */
    chatStream(params: {
      content: string;
      sessionId: string;
      metadata?: Record<string, unknown>;
    }): AsyncGenerator<
      ChatStreamChunk,
      { content: string; finishReason?: string; sessionId?: string },
      unknown
    >;
  };
  /** 出站回调（处理完消息后的回复发送） */
  onOutbound?: (content: string, target: string) => Promise<void>;
  /**
   * 出站文件回调（2026-08-20 spec qq-file-transfer）
   * 回复文本中提取到可发送的本地文件路径时逐个调用；渠道不支持文件时不绑定
   */
  onOutboundFile?: (filePath: string, target: string) => Promise<void>;
  /**
   * AC-5③（2026-08-20 渠道对齐）：启用长任务占位提示。
   * 仅平台存在被动回复窗口的渠道（capabilities.passiveReplyWindow，如 QQ）
   * 需要——占位消耗一次被动回复配额以保活；无窗口约束的渠道
   * （email/sms/webhook 等主动 API 出站）发占位是纯干扰，缺省不发送。
   */
  enableLongTaskPlaceholder?: boolean;
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
    onOutboundFile,
    channelName = 'unknown',
    enableTracing = false,
  } = options;

  const otel = getOTelTracing();
  const routeSpan = otel.startSpan('channel.routeMessage', {
    'channel.name': channelName,
    'message.id': message.messageId,
  });

  // 可观测性（指标）：入站计数 + 处理耗时起点
  const processingStartMs = Date.now();
  recordInboundMessage();

  // [0] 生成全链路 traceId（先于入口日志生成，后续所有阶段日志均携带，grep traceId 即可串联全链路）
  const traceId = `ch_trc_${channelName}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  logger.info(`[TRACE] ${traceId} 消息路由入口`, {
    channelName,
    messageId: message.messageId,
    senderId: message.senderId,
    conversationId: message.conversationId,
    contentLength: message.content?.length || 0,
    hasOnOutbound: !!onOutbound,
  });

  // 方案 B：业务 traceId 写入 OTel span 属性，Jaeger/Tempo 可按业务 ID 检索消息链路
  // （OTel span 自身 traceId 与业务 traceId 独立，不打通则外部后端无法按业务检索）
  routeSpan.setAttribute('channel.trace_id', traceId);

  // 消息级链路追踪（方案 A）：入站即登记，各阶段追加，终态收敛
  messageTraceBuffer.begin({
    traceId,
    channelName,
    messageId: message.messageId,
    senderId: message.senderId,
    contentPreview: message.content?.slice(0, 50),
  });

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
    logger.warning(`[TRACE] ${traceId} 阶段失败: frame_check`, {
      channelName,
      messageId: message.messageId,
      errors: validation.errors,
    });
    recordMessageRejected(validation.errorCode || 'INVALID_FRAME');
    messageTraceBuffer.addStage(
      traceId,
      'frame_check',
      'fail',
      validation.errors?.join('; ')
    );
    messageTraceBuffer.finish(
      traceId,
      'rejected',
      validation.errorCode || 'INVALID_FRAME'
    );
    otel.endSpan(routeSpan);
    return {
      valid: false,
      errorCode: validation.errorCode || 'INVALID_FRAME',
      errorMessage: validation.errors?.join('; ') || '消息格式无效',
    };
  }
  messageTraceBuffer.addStage(traceId, 'frame_check', 'ok');
  logger.info(`[TRACE] ${traceId} 阶段通过: frame_check`, {
    messageId: message.messageId,
  });

  // ①-② DM 策略授权（2026-08-06 接入，P0-2）：
  // 各渠道 security.dmPolicy（pairing/allowlist/open）由调用方经 options.dmPolicy 传入，
  // 未授权消息在进入去重/会话/LLM 链路前即被拦截。
  if (options.dmPolicy) {
    const dmEngine = new DmPolicyEngine(options.dmPolicy);
    const authResult = await dmEngine.authorize(message);
    if (!authResult.allowed) {
      logger.warning(`[TRACE] ${traceId} 阶段失败: dm_auth`, {
        channelName,
        senderId: message.senderId,
        reason: authResult.reason,
      });
      recordMessageRejected('UNAUTHORIZED');
      messageTraceBuffer.addStage(
        traceId,
        'dm_auth',
        'fail',
        authResult.reason
      );
      messageTraceBuffer.finish(traceId, 'rejected', 'UNAUTHORIZED');
      otel.endSpan(routeSpan);
      return {
        valid: false,
        errorCode: 'UNAUTHORIZED',
        errorMessage: authResult.reason || '发送者未获授权',
      };
    }
    messageTraceBuffer.addStage(traceId, 'dm_auth', 'ok');
    logger.info(`[TRACE] ${traceId} 阶段通过: dm_auth`, {
      senderId: message.senderId,
    });
  }

  // ② 去重检查（messageId 级）——先于限流，避免重复事件浪费限流额度（BUG-4）
  const claimResult = claimMessage(message.messageId);
  if (claimResult === 'duplicate') {
    logger.info(`[TRACE] ${traceId} 阶段跳过: dedup(duplicate)`, {
      channelName,
      messageId: message.messageId,
    });
    recordMessageRejected('duplicate');
    messageTraceBuffer.addStage(traceId, 'dedup', 'skip', 'duplicate');
    messageTraceBuffer.finish(traceId, 'rejected', 'duplicate');
    otel.endSpan(routeSpan);
    return { valid: true, response: 'duplicate_skipped' };
  }
  if (claimResult === 'inflight') {
    logger.info(`[TRACE] ${traceId} 阶段跳过: dedup(inflight)`, {
      channelName,
      messageId: message.messageId,
    });
    recordMessageRejected('inflight');
    messageTraceBuffer.addStage(traceId, 'dedup', 'skip', 'inflight');
    messageTraceBuffer.finish(traceId, 'rejected', 'inflight');
    otel.endSpan(routeSpan);
    return { valid: true, response: 'inflight_skipped' };
  }
  if (claimResult === 'invalid') {
    recordMessageRejected('INVALID_ID');
    messageTraceBuffer.addStage(traceId, 'dedup', 'skip', 'invalid');
    messageTraceBuffer.finish(traceId, 'rejected', 'INVALID_ID');
    otel.endSpan(routeSpan);
    return { valid: false, errorCode: 'INVALID_ID' };
  }
  messageTraceBuffer.addStage(traceId, 'dedup', 'ok');
  logger.info(`[TRACE] ${traceId} 阶段通过: dedup`, {
    messageId: message.messageId,
  });

  // ②-② 内容级去重检查（兜底：不同 messageId 但内容相同的重复事件）
  if (message.content) {
    // DEEP-7：内容去重 key 增加 senderId 维度，避免误杀不同用户发送的相同内容
    const contentKey = `${message.channelId || channelName}:${message.senderId}:${message.content}`;
    const now = Date.now();
    const lastContentTime = contentDedupCache.get(contentKey);
    if (lastContentTime && now - lastContentTime < CONTENT_DEDUP_WINDOW_MS) {
      logger.info(`[TRACE] ${traceId} 阶段跳过: dedup(content_dedup)`, {
        channelName,
        contentKey: contentKey.slice(0, 100),
        ageMs: now - lastContentTime,
      });
      // 也释放 messageId 级别的锁
      releaseProcessing(message.messageId);
      recordMessageRejected('content_dedup');
      messageTraceBuffer.addStage(traceId, 'dedup', 'skip', 'content_dedup');
      messageTraceBuffer.finish(traceId, 'rejected', 'content_dedup');
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
    logger.warning(`[TRACE] ${traceId} 阶段失败: rate_limit`, {
      channelName,
      senderId: message.senderId,
    });
    // P1-1：claimMessage 已持锁，限流拒绝路径必须释放锁，
    // 否则该 messageId 永久残留 inflight 集合，渠道重传被无限拦截
    releaseProcessing(message.messageId);
    recordMessageRejected('RATE_LIMITED');
    messageTraceBuffer.addStage(traceId, 'rate_limit', 'fail', 'RATE_LIMITED');
    messageTraceBuffer.finish(traceId, 'rejected', 'RATE_LIMITED');
    otel.endSpan(routeSpan);
    return {
      valid: false,
      errorCode: 'RATE_LIMITED',
      errorMessage: '发送过于频繁，请稍后再试',
    };
  }
  messageTraceBuffer.addStage(traceId, 'rate_limit', 'ok');
  logger.info(`[TRACE] ${traceId} 阶段通过: rate_limit`, {
    senderId: message.senderId,
  });

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
          messageTraceBuffer.addStage(traceId, 'shared_session', 'ok');
          logger.info(`[TRACE] ${traceId} 阶段通过: shared_session`, {
            messageId: message.messageId,
          });
        }
      }
    } catch (sessionError) {
      // @ignore-catch: 非关键路径，写入失败不影响主路由流程
      logger.warning(`[TRACE] ${traceId} 阶段失败: shared_session`, {
        messageId: message.messageId,
        error: String(sessionError),
      });
      messageTraceBuffer.addStage(
        traceId,
        'shared_session',
        'fail',
        String(sessionError).slice(0, 200)
      );
    }

    // DEEP-12：群聊场景下 conversationId 是群 ID，所有用户共享会导致上下文互相污染
    // 非 DM 消息时在会话键中注入 senderId 区分不同用户
    const sessionKey = message.isDirectMessage
      ? (message.conversationId ?? message.senderId)
      : `${message.conversationId ?? message.senderId}:${message.senderId}`;

    // ④ 会话创建/复用 → ⑤ CoreAPI.chatStream()
    logger.info(
      `[TRACE] ${traceId} 阶段开始: llm (CoreAPI.chatStream 流式并轨)`,
      {
        messageId: message.messageId,
        sessionId: sessionKey,
        contentLength: message.content.length,
      }
    );

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
    // Windows 兼容（根因修复 2026-08-20）：sessionKey 含 ':'（如 QQ 的 "c2c:{openid}"），
    // 直接作为持久化目录名导致 mkdir ENOTDIR → createSession 失败 → chat 报错 → 渠道无回复。
    // 确定性映射保证同一会话每次生成相同 ID，会话复用不受影响。
    const safeSessionId = sanitizeSessionId(sessionKey);
    messageTraceBuffer.addStage(traceId, 'session', 'ok', safeSessionId);
    logger.info(`[TRACE] ${traceId} 阶段通过: session`, {
      messageId: message.messageId,
      sessionKey,
      safeSessionId,
      serializedKey,
    });
    const llmStartMs = Date.now();
    const response = await runSerialized(serializedKey, async () => {
      // 流式并轨（2026-08-20）：渠道消息改走 chatStream 流式轨道（与 client
      // /v1/chat/stream 同管线）。内部消费流、聚合文本，对外仍发一条完整消息——
      // 工具循环/上下文压缩/Write-Ahead 持久化全部由 StreamPipeline 内联编排，
      // 替代原"非流式 chat → TAOR 委托"链路（P0-1/P0-2 之上的根治，双轨收敛）。
      // 超时语义同步从"绝对 2 分钟"改为 STREAM_IDLE_TIMEOUT_MS 活动心跳超时，
      // 长程任务只要在推进（持续产出 chunk）就不会被掐断。
      const generator = coreAPI.chatStream({
        content: message.content,
        sessionId: safeSessionId,
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

      let aggregatedText = '';
      let chunkCount = 0;
      let toolCallChunks = 0;
      let lastToolLogMs = Date.now();
      let streamError: string | undefined;
      let placeholderSent = false;
      // P1-1：首个工具进度通知是否已发送（每任务仅 1 条，QQ seq 配额感知）
      let firstToolNotified = false;
      const outboundTarget = message.conversationId ?? message.senderId;

      try {
        for (;;) {
          // 每次等待下一个 chunk 均带独立空转计时器；chunk 到达即重置（活动心跳）
          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
          const idlePromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(
              () =>
                reject(
                  new Error(
                    `chatStream 空转超时 (>${STREAM_IDLE_TIMEOUT_MS / 1000}s 无 chunk)`
                  )
                ),
              STREAM_IDLE_TIMEOUT_MS
            );
          });
          let result: IteratorResult<
            ChatStreamChunk,
            { content: string; finishReason?: string }
          >;
          try {
            result = await Promise.race([generator.next(), idlePromise]);
          } finally {
            clearTimeout(timeoutHandle);
          }

          if (result.done) {
            // generator return = 最终 ChatResponse（Write-Ahead：done 前已持久化）
            const final = result.value;
            if (streamError) {
              return { content: '', finishReason: 'error' };
            }
            return {
              content: final.content || aggregatedText,
              finishReason: final.finishReason ?? 'stop',
            };
          }

          const chunk = result.value;
          chunkCount++;
          switch (chunk.type) {
            case 'text':
              aggregatedText += chunk.content ?? '';
              break;
            case 'tool_call':
              toolCallChunks++;
              // 工具活动日志（节流：首个必记，之后每 30s 至多 1 条，防刷屏）
              if (toolCallChunks === 1 || Date.now() - lastToolLogMs > 30_000) {
                lastToolLogMs = Date.now();
                logger.info(`[TRACE] ${traceId} 流式工具活动`, {
                  messageId: message.messageId,
                  toolCallSeq: toolCallChunks,
                  toolName: chunk.toolCall?.name,
                  toolStatus: chunk.toolCall?.status,
                  chunkCount,
                });
              }
              // P1-1（2026-08-20）：首个工具开始时向渠道推送进度通知，
              // 消除"AI 沉默执行、渠道侧无感知"（根因③）。配额感知设计：
              // 每任务仅 1 条（QQ 同 msg_id 被动回复上限 5 条——
              // 工具通知 seq=1 + 长任务占位 seq=2 + 最终回复 seq=3，安全区内）。
              // 与占位提示共用 enableLongTaskPlaceholder 门控（仅被动回复窗口渠道）。
              // 发送失败不中断主流程。
              if (
                !firstToolNotified &&
                options.enableLongTaskPlaceholder === true &&
                chunk.toolCall?.name
              ) {
                firstToolNotified = true;
                try {
                  await onOutbound?.(
                    `🔧 ${formatToolNotifySummary(chunk.toolCall.name, chunk.toolCall.arguments)}…`,
                    outboundTarget
                  );
                  logger.info(`[TRACE] ${traceId} 工具进度通知已发送`, {
                    messageId: message.messageId,
                    toolName: chunk.toolCall.name,
                    target: outboundTarget,
                  });
                } catch (notifyErr) {
                  await handleError(notifyErr, {
                    module: 'channels:routing',
                    action: 'toolProgressNotify',
                    context: { traceId, channelName },
                  });
                }
              }
              break;
            case 'error':
              streamError = chunk.content || chunk.errorCode || 'stream error';
              logger.warning(`[TRACE] ${traceId} 流式错误 chunk`, {
                messageId: message.messageId,
                errorCode: chunk.errorCode,
                contentPreview: (chunk.content ?? '').slice(0, 120),
              });
              break;
            case 'question':
              // 渠道无法呈现交互 UI（预存缺口）：记录日志，流按既有降级策略继续。
              // 后续如需支持，可在此将 question 转发为渠道文本提问。
              logger.info(
                `[TRACE] ${traceId} 流式出现交互提问（渠道暂不支持 UI 交互）`,
                {
                  messageId: message.messageId,
                  questionPreview: (chunk.content ?? '').slice(0, 80),
                }
              );
              break;
            default:
              // thinking/status/todo/execution_phase 等：进度类 chunk，渠道不需要逐条处理
              break;
          }

          // AC-5③：长任务占位提示（见 LONG_TASK_PLACEHOLDER_AFTER_MS 注释）。
          // 在被动回复窗口关闭前先送达一条"仍在执行"，避免长任务静默期用户无感知；
          // 仅对声明了被动回复窗口的渠道启用（enableLongTaskPlaceholder，
          // 2026-08-20 渠道对齐：email/sms/webhook 等主动出站渠道不受窗口约束，
          // 占位消息纯属干扰——2 封邮件/收费短信/下游误处理）。
          // 占位发送失败不中断主流程（最终回复仍会尝试出站）。
          if (
            !placeholderSent &&
            options.enableLongTaskPlaceholder === true &&
            Date.now() - llmStartMs > LONG_TASK_PLACEHOLDER_AFTER_MS
          ) {
            placeholderSent = true;
            try {
              await onOutbound?.(
                '⏳ 任务仍在执行中，预计还需一些时间，完成后立即回复',
                outboundTarget
              );
              logger.info(`[TRACE] ${traceId} 长任务占位提示已发送`, {
                messageId: message.messageId,
                target: outboundTarget,
                elapsedMs: Date.now() - llmStartMs,
              });
            } catch (placeholderErr) {
              await handleError(placeholderErr, {
                module: 'channels:routing',
                action: 'longTaskPlaceholder',
                context: { traceId, channelName },
              });
            }
          }
        }
      } catch (streamErr) {
        // 空转超时/消费异常：必须关闭 generator 释放底层会话互斥锁
        // （对齐 chat-handlers P2-10：否则 streamMessage 的 SimpleMutex 永不释放）
        try {
          await Promise.race([
            generator.return({ content: '', finishReason: 'error' }),
            new Promise<void>((r) => setTimeout(r, 5000)),
          ]);
        } catch {
          // @ignore-catch — 关闭失败不应掩盖原始异常
        }
        throw streamErr;
      }
    });

    logger.info(`[TRACE] ${traceId} 阶段完成: llm`, {
      messageId: message.messageId,
      hasContent: !!response.content,
      responseLength: response.content?.length || 0,
      finishReason: (response as Record<string, unknown>).finishReason,
      llmDurationMs: Date.now() - llmStartMs,
    });

    // DEEP-5：CoreAPI 返回 error 时，消息不应标记为已处理（否则 LLM 错误后渠道重传同一消息被丢弃）
    const finishReason = (response as Record<string, unknown>).finishReason;
    messageTraceBuffer.addStage(
      traceId,
      'llm',
      finishReason === 'error' ? 'fail' : 'ok',
      `finishReason=${finishReason}`,
      Date.now() - llmStartMs
    );
    if (finishReason === 'error') {
      logger.warning(
        `[TRACE] ${traceId} 阶段失败: llm (finishReason=error)，释放消息锁但不标记已处理`,
        {
          messageId: message.messageId,
          channelName,
        }
      );
      releaseProcessing(message.messageId);
      recordMessageRejected('LLM_ERROR');
      recordMessageProcessing(channelName, Date.now() - processingStartMs);
      messageTraceBuffer.finish(traceId, 'fail', 'LLM_ERROR');
      otel.endSpan(routeSpan);
      // 兜底出站（2026-08-20 QQ 空响应事故）：LLM 错误时用户侧不能沉默。
      // 此前仅返回 errorCode，上层（setupChannels）只记日志不出站 → 用户
      // 长时间无任何反馈。降级文案走被动回复通道，失败不掩盖原错误。
      if (onOutbound) {
        try {
          await onOutbound(
            '⚠️ 消息处理失败，请稍后重发重试。',
            message.conversationId ?? message.senderId
          );
        } catch (fallbackErr) {
          await handleError(fallbackErr, {
            module: 'channels:routing',
            action: 'llmErrorFallbackOutbound',
            context: { traceId, channelName },
          });
        }
      }
      return {
        valid: false,
        errorCode: 'LLM_ERROR',
        errorMessage: '消息处理失败，请稍后重试',
      };
    }

    // 2026-08-20 QQ 空响应事故：finishReason=stop 但内容为空（DeepSeek 对污染
    // 历史返回 chunkCount=0 的静默空响应）。与 error 分支同样必须让用户可见，
    // 且不标记已处理（清洗防御修复后重发可恢复）。
    if (!response.content || response.content.trim() === '') {
      logger.warning(
        `[TRACE] ${traceId} 阶段异常: llm 空响应（finishReason=${finishReason}，内容为空，疑似历史污染致 LLM 静默返回），释放消息锁但不标记已处理`,
        {
          messageId: message.messageId,
          channelName,
          finishReason,
        }
      );
      releaseProcessing(message.messageId);
      recordMessageRejected('EMPTY_LLM_RESPONSE');
      recordMessageProcessing(channelName, Date.now() - processingStartMs);
      messageTraceBuffer.finish(traceId, 'fail', 'EMPTY_LLM_RESPONSE');
      otel.endSpan(routeSpan);
      if (onOutbound) {
        try {
          await onOutbound(
            '⚠️ 本次未能生成回复（模型返回空响应），请重发消息重试。',
            message.conversationId ?? message.senderId
          );
        } catch (fallbackErr) {
          await handleError(fallbackErr, {
            module: 'channels:routing',
            action: 'emptyResponseFallbackOutbound',
            context: { traceId, channelName },
          });
        }
      }
      return {
        valid: false,
        errorCode: 'EMPTY_LLM_RESPONSE',
        errorMessage: '模型返回空响应，请重发重试',
      };
    }

    // ⑥ 出站回调 + 追踪完成
    if (response.content && onOutbound) {
      const target = message.conversationId ?? message.senderId;
      logger.info(`[TRACE] ${traceId} 阶段开始: outbound`, {
        messageId: message.messageId,
        target,
        responseLength: response.content.length,
      });
      const outboundStartMs = Date.now();
      try {
        await onOutbound(response.content, target);
        messageTraceBuffer.addStage(
          traceId,
          'outbound',
          'ok',
          target,
          Date.now() - outboundStartMs
        );
      } catch (outboundErr) {
        messageTraceBuffer.addStage(
          traceId,
          'outbound',
          'fail',
          String(outboundErr).slice(0, 200),
          Date.now() - outboundStartMs
        );
        throw outboundErr;
      }
      logger.info(`[TRACE] ${traceId} 阶段完成: outbound`, {
        messageId: message.messageId,
        target,
        outboundDurationMs: Date.now() - outboundStartMs,
      });

      // 2026-08-20 spec qq-file-transfer：回复文本中含本地文件路径时
      // 追加文件消息发送（multipart 上传 QQ 媒体库）。文本已送达为事实，
      // 文件失败不抛错，补发一条文本反馈。
      if (onOutboundFile) {
        await sendOutboundFiles(
          response.content,
          target,
          traceId,
          onOutboundFile,
          onOutbound
        );
      }
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
    messageTraceBuffer.finish(traceId, 'ok');
    logger.info(`[TRACE] ${traceId} 全链路完成`, {
      messageId: message.messageId,
      channelName,
      totalDurationMs: Date.now() - processingStartMs,
      responseLength: response.content?.length || 0,
    });
    otel.endSpan(routeSpan);
    return { valid: true, response: response.content };
  } catch (error) {
    // 释放消息锁
    releaseProcessing(message.messageId);
    messageTraceBuffer.finish(
      traceId,
      'fail',
      error instanceof Error ? error.message.slice(0, 300) : String(error)
    );
    logger.error(`[TRACE] ${traceId} 全链路异常终止`, {
      messageId: message.messageId,
      channelName,
      totalDurationMs: Date.now() - processingStartMs,
      error: error instanceof Error ? error.message : String(error),
    });

    // BUG-5：超时后补标记 processed，防止渠道重传同一消息导致重复处理
    // （LLM 请求超时≠请求失败，重传会再次触发 LLM 调用造成重复计费）
    const isTimeout =
      error instanceof Error &&
      (error.message.includes(
        `空转超时 (>${STREAM_IDLE_TIMEOUT_MS / 1000}s 无 chunk)`
      ) ||
        error.message.includes(`超时 (>${CHAT_TIMEOUT_MS / 1000}s)`));
    if (isTimeout) {
      markMessageProcessed(message.messageId);
      logger.warning(
        `[TRACE] ${traceId} chatStream 空转超时，消息标记为已处理（避免重传重复计费）`,
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
