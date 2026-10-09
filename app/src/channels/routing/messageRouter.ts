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
// C1（2026-10-09）：traceId 熵源改用 crypto（统一 ID 工具）
import { randomIdSuffix, sleep } from '../../utils/common';
import {
  claimMessage,
  releaseProcessing,
  finalizeMessage,
  rejectMessage,
} from '../dedup/index';
import type { MessageContext } from '../types/IChannel';
// 2026-10-01 D-206（子批 D，`channels -> ai` 倒挂收口，2 条边之一）：类型位改**相对直连
// core 模块根**（`SessionSpanContext` 已随实现下沉 core；app 层原址转出）。
import type { SessionSpanContext } from '../../core/SessionSpanTracer.js';
import { channelSessionManager } from '../session/ChannelSessionManager';
import { isBridgeEnabled } from '../setupChannels';
// 2026-08-06 接入（P0-2）：DM 策略授权引擎（pairing/allowlist/open）
import { DmPolicyEngine } from '../policy/DmPolicy';
// 2026-08-06 接入（P1-5）：渠道入站限流（按渠道+sender 令牌桶）
import { checkRateLimit } from './rateLimiter';
// 2026-08-20 流式并轨：渠道消息改走 chatStream 流式轨道（与 client 同管线）
// PR1（2026-10-09）：Execution 生命周期（ownership + generation fencing；详见 spec）
// PR2（2026-10-09）：类型化中止原因（替代 error.message 文案匹配；CS02）
import {
  getExecutionManager,
  isExecutionAbortedError,
} from '@modules/execution';
// PR2（2026-10-09）：两段式取消灰度开关（默认关 = 保留既有"超时即释放"行为）
import { feature } from '@modules/core';
// ── C3-S3（2026-10-09）：自本文件迁出的契约 / 助手 / 帧验证 / 内容去重 / 出站 / 流式消费 ──
import {
  CANCEL_GRACE_MS,
  SESSION_ADMISSION_WAIT_MS,
  ADMISSION_POLL_MS,
} from './messageRouterContract';
import type {
  RouteResult,
  FrameValidationResult,
  RouteMessageOptions,
} from './messageRouterContract';
import {
  sanitizeSessionId,
  runSerialized,
  resolveAdmissionWaitMs,
} from './messageRouterSerialization';
import { claimContentDedup } from './contentDedup';
import { tryHandleTextApproval } from './textApproval';
import { deliverChannelOutbound } from './channelOutbound';
import { consumeStreamChunks } from './streamConsumption';
import { validateInboundFrame } from './messageFrameValidation';

// 对外 API 重导出（`routing/messageRouter` 仍是对外唯一入口；R03-002）
export type { RouteResult, FrameValidationResult, RouteMessageOptions };
export { validateInboundFrame };

const logger = getLogger('channels:routing');

// ── C3-S3（2026-10-09）：契约 / 常量 / 助手 / 帧验证已迁出 ──
// 见 `.trae/specs/message-router-split.md`。`routeChannelMessage` 仍**定义于本文件**
// （R03-004 渠道入站唯一入口，门禁依赖其路径/函数名）。常量为**值导入**（供下方使用），
// 对外类型与 `validateInboundFrame` 经 `export` 重导出以保持 API 不变。

// 路由/帧验证/选项类型已迁至 `./messageRouterContract`（经下方 export 重导出）。

// 串行队列 / runSerialized → `./messageRouterSerialization`
// validateInboundFrame → `./messageFrameValidation`（已在上方重导出）

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
  const traceId = `ch_trc_${channelName}_${Date.now()}_${randomIdSuffix(4)}`;

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
    // C3-S3（2026-10-09）：去重维度与缓存已内聚到 `./contentDedup`（语义逐字不变）。
    // 维度 = 渠道 : 会话 : 发送者 : 内容（DEEP-7 补 senderId；PR4 补 conversationId）。
    const { duplicate, contentKey, ageMs } = claimContentDedup(
      message,
      channelName
    );
    if (duplicate) {
      logger.info(`[TRACE] ${traceId} 阶段跳过: dedup(content_dedup)`, {
        channelName,
        contentKey: contentKey.slice(0, 100),
        ageMs,
      });
      // 也释放 messageId 级别的锁
      releaseProcessing(message.messageId);
      recordMessageRejected('content_dedup');
      messageTraceBuffer.addStage(traceId, 'dedup', 'skip', 'content_dedup');
      messageTraceBuffer.finish(traceId, 'rejected', 'content_dedup');
      otel.endSpan(routeSpan);
      return { valid: true, response: 'duplicate_skipped' };
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
        await import('../../session/types/UnifiedMessage');
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

    // ── 纯文本审批前置检查（C3-S3：已内聚到 `./textApproval`，语义不变）──
    const approvalResult = await tryHandleTextApproval({
      message,
      channelSessionId: channelSession?.id ?? null,
      onOutbound,
      traceId,
      channelName,
    });
    if (approvalResult) {
      otel.endSpan(routeSpan);
      return approvalResult;
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
      // PR1（2026-10-09）：把本次 Agent 运行登记进 Execution 生命周期
      // （ownership + generation fencing）。**纯记账、默认零行为变更**：
      // 完成/失败经 `ExecutionManager` 的 fencing 判定，被顶替（STALE）时静默忽略，
      // 绝不改写新执行的 session 状态。
      const executionManager = getExecutionManager();
      let lease = executionManager.acquire(safeSessionId, message.messageId);
      // PR2 遗留-2（2026-10-09）：**Router 级准入** —— 本执行以 QUEUED 创建（会话仍被"未确认
      // 取消"的上一执行占用）⇒ 有界等待所有权；超时 ⇒ 放弃本次执行（不启动 LLM）。
      // 由 `EXECUTION_TWO_PHASE_CANCEL` 门控（默认关 ⇒ 行为不变）。
      if (feature('EXECUTION_TWO_PHASE_CANCEL') && !lease.isCurrent()) {
        const admissionDeadline = Date.now() + resolveAdmissionWaitMs();
        while (!lease.isCurrent() && Date.now() < admissionDeadline) {
          lease.release(); // 释放本次 QUEUED 尝试（避免堆积记录）
          await sleep(ADMISSION_POLL_MS);
          lease = executionManager.acquire(safeSessionId, message.messageId);
        }
        if (!lease.isCurrent()) {
          lease.release();
          logger.warning(
            `[TRACE] ${traceId} 会话占用超等待上限，放弃本次执行（不启动 LLM）`,
            {
              messageId: message.messageId,
              channelName,
              sessionId: safeSessionId,
              waitMs: SESSION_ADMISSION_WAIT_MS,
            }
          );
          recordMessageRejected('SESSION_BUSY');
          recordMessageProcessing(channelName, Date.now() - processingStartMs);
          messageTraceBuffer.addStage(
            traceId,
            'admission',
            'fail',
            'SESSION_BUSY'
          );
          return { content: '', finishReason: 'busy' };
        }
      }
      // PR3（2026-10-09）：登记到渠道会话，防 cleanIdle 在执行期间误回收会话。
      const channelSessionId = channelSession?.id;
      if (channelSessionId) {
        channelSessionManager.beginExecution(
          channelSessionId,
          lease.executionId
        );
      }
      const finishExecution = (ok: boolean, reason?: string): void => {
        try {
          if (ok) executionManager.complete(lease.executionId);
          else executionManager.fail(lease.executionId, reason ?? 'unknown');
        } catch {
          // @ignore-catch — fencing：执行已被顶替/已终结（STALE）⇒ 忽略，不改写新执行
        }
        if (channelSessionId) {
          channelSessionManager.endExecution(
            channelSessionId,
            lease.executionId
          );
        }
        lease.release();
      };
      // 流式并轨（2026-08-20）：渠道消息改走 chatStream 流式轨道（与 client
      // /v1/chat/stream 同管线）。内部消费流、聚合文本，对外仍发一条完整消息——
      // 工具循环/上下文压缩/Write-Ahead 持久化全部由 StreamPipeline 内联编排，
      // 替代原"非流式 chat → TAOR 委托"链路（P0-1/P0-2 之上的根治，双轨收敛）。
      // 超时语义同步从"绝对 2 分钟"改为 STREAM_IDLE_TIMEOUT_MS 活动心跳超时，
      // 长程任务只要在推进（持续产出 chunk）就不会被掐断。
      // PR2（2026-10-09）：本执行的外部取消信号（两段式取消 + 端到端贯通）。
      // 超时时 `abort()` 它 ⇒ 经 CoreAPI → ChatManager 中继到会话 controller ⇒
      // 底层 Provider fetch / 工具执行停止（复用既有内部取消链路）。
      const cancelController = new AbortController();
      const generator = coreAPI.chatStream({
        content: message.content,
        sessionId: safeSessionId,
        // PR1（2026-10-09）：执行标识外显（契约；消费者接线随 PR2/PR5 展开）
        executionId: lease.executionId,
        // PR2（2026-10-09）：ABORT 信号端到端贯通（Router → CoreAPI → ChatManager → ToolRunner）
        signal: cancelController.signal,
        // P26-1 §9.1（2026-10-07）：渠道入站**非人工实时对话** ⇒ 显式声明后台优先级
        // （供 resourceGovernor 在同会话外按优先级取舍；缺省本为 interactive）
        priority: 'background',
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

      // C3-S3-S2（2026-10-09）：流式消费循环已内聚到 `./streamConsumption`（语义不变）。

      try {
        return await consumeStreamChunks({
          generator,
          cancelController,
          executionManager,
          lease,
          message,
          channelName,
          traceId,
          enableLongTaskPlaceholder: options.enableLongTaskPlaceholder === true,
          onOutbound,
          llmStartMs,
          finishExecution,
        });
      } catch (streamErr) {
        // 空转超时/消费异常：关闭 generator 释放底层会话互斥锁
        // （对齐 chat-handlers P2-10：否则 streamMessage 的 SimpleMutex 永不释放）。
        // PR2（2026-10-09）：`generator.return()` 为 **best-effort cleanup**，同时作为
        // 两段式取消的 **grace 窗口**（CANCEL_GRACE_MS）：窗口内 resolve ⇒ 确认底层已停止。
        // 注意 `settled` 经 `Promise.race` 的**返回值**赋值（非闭包副作用），避免 CFA 误窄化。
        const settled = await Promise.race([
          generator
            .return({ content: '', finishReason: 'error' })
            .then(() => true),
          new Promise<boolean>((r) =>
            setTimeout(() => r(false), CANCEL_GRACE_MS)
          ),
        ]).catch(() => false);

        const abortReason = isExecutionAbortedError(streamErr)
          ? streamErr.reason
          : undefined;

        if (
          feature('EXECUTION_TWO_PHASE_CANCEL') &&
          abortReason === 'INACTIVITY_TIMEOUT'
        ) {
          if (settled) {
            // 第二段确认：grace 内底层已停止 ⇒ CANCEL_REQUESTED → CANCELLED，释放所有权
            executionManager.confirmCancel(lease.executionId);
            if (channelSessionId) {
              channelSessionManager.endExecution(
                channelSessionId,
                lease.executionId
              );
            }
            lease.release();
            logger.warning(`[TRACE] ${traceId} 两段式取消已确认（CANCELLED）`, {
              messageId: message.messageId,
              channelName,
              executionId: lease.executionId,
            });
          } else {
            // 未确认 ⇒ **保留 lease**：不 finishExecution、不 release。
            // 执行停留 CANCEL_REQUESTED（占用中）⇒ 后续消息 acquire 排队 QUEUED，不启动下一次。
            logger.warning(
              `[TRACE] ${traceId} 两段式取消 grace 内未确认，保留 lease（CANCEL_REQUESTED）`,
              {
                messageId: message.messageId,
                channelName,
                executionId: lease.executionId,
                graceMs: CANCEL_GRACE_MS,
              }
            );
          }
        } else {
          finishExecution(false, String(streamErr));
        }
        throw streamErr;
      }
    });

    logger.info(`[TRACE] ${traceId} 阶段完成: llm`, {
      messageId: message.messageId,
      hasContent: !!response.content,
      responseLength: response.content?.length || 0,
      finishReason: response.finishReason,
      llmDurationMs: Date.now() - llmStartMs,
    });

    const finishReason = response.finishReason;

    // PR2 遗留-2（2026-10-09）：**会话占用（准入拒绝）** —— 未启动 LLM（见回调内 admission）。
    // 释放消息锁但**不标记已处理** ⇒ 允许渠道/用户稍后重试；同时给用户一条可见反馈。
    if (finishReason === 'busy') {
      logger.warning(
        `[TRACE] ${traceId} 阶段失败: admission（SESSION_BUSY），未启动 LLM，释放消息锁但不标记已处理`,
        { messageId: message.messageId, channelName }
      );
      releaseProcessing(message.messageId);
      recordMessageRejected('SESSION_BUSY');
      recordMessageProcessing(channelName, Date.now() - processingStartMs);
      messageTraceBuffer.finish(traceId, 'fail', 'SESSION_BUSY');
      otel.endSpan(routeSpan);
      if (onOutbound) {
        try {
          await onOutbound(
            '⚠️ 该会话上一条消息仍在处理中，本次未能执行，请稍后重发重试。',
            message.conversationId ?? message.senderId
          );
        } catch (busyErr) {
          await handleError(busyErr, {
            module: 'channels:routing',
            action: 'sessionBusyFallbackOutbound',
            context: { traceId, channelName },
          });
        }
      }
      return {
        valid: false,
        errorCode: 'SESSION_BUSY',
        errorMessage: '会话上一条消息仍在处理中，请稍后重试',
      };
    }

    // DEEP-5：CoreAPI 返回 error 时，消息不应标记为已处理（否则 LLM 错误后渠道重传同一消息被丢弃）
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

    // ⑥ 出站回调 + 追踪完成（C3-S3：出站已内聚到 `./channelOutbound`，语义不变）
    await deliverChannelOutbound({
      responseContent: response.content,
      target: message.conversationId ?? message.senderId,
      traceId,
      messageId: message.messageId,
      onOutbound,
      onOutboundFile,
    });

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

    const abortReason = isExecutionAbortedError(error)
      ? error.reason
      : undefined;
    if (abortReason === 'INACTIVITY_TIMEOUT') {
      // PR4（2026-10-09，`.trae/specs/dedup-message-state.md`）：空转超时 ⇒ 真实语义
      // **REJECTED**（已接收、未成功、TTL 窗口内阻断同 messageId 重传，防重复计费），
      // 取代原"伪造已处理"（`markMessageProcessed`）。E3 根修：Dedup 表达"是否已接收"
      // 而非"Agent 是否成功完成"。
      rejectMessage(message.messageId);
      logger.warning(
        `[TRACE] ${traceId} chatStream 空转超时（INACTIVITY_TIMEOUT），消息标记为 REJECTED（阻断重传；语义非"已完成"）`,
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
