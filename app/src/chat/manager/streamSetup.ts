// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ChatStreamSetup —— 流式请求准备段（ChatManager 拆分批 U-22/S2）
 *
 * **来源**：从 `ChatManager._prepareStreamSession` 整段外移（208 行）。
 *
 * **职责（单一：把「一轮流式请求」准备好）**：输入净化/安全校验 → 取会话 → 中止旧流 →
 * 登记 abort/executionId → 流式检查点 + 会话互斥锁 → pre-message hook → 用户消息落盘 →
 * 会话状态机 `processUserInput` → OTel span。
 *
 * **行为等价**：执行顺序、日志文案、异常类型与出参**逐字未变**（仅 `this.` → 注入 deps）。
 */

import { getLogger, getOTelTracing } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { SensitiveErrorType } from '@modules/security';
import { recursivelySanitizeUnicode } from '@modules/utils/sanitization.js';
import type {
  Message,
  StreamMessageOptions,
} from '@modules/session/types/message.js';
import type { ChatSession } from '@modules/session/types/session.js';
import type { SimpleMutex } from '@openliri/kernel';

import { securityService } from '../services/SecurityService.js';
import { StreamingAutoCheckpoint } from '../services/StreamingAutoCheckpoint.js';

const logger = getLogger('chat:manager');

export interface StreamSetupResult {
  content: string;
  session: ChatSession;
  streamAbortController: AbortController;
  streamingCheckpoint: StreamingAutoCheckpoint;
  mutex: SimpleMutex;
  userMessage: Message;
  streamSpan: ReturnType<typeof getOTelTracing> extends {
    startSpan: (...args: any[]) => infer S;
  }
    ? S
    : never;
}

export interface StreamSetupDeps {
  currentSessionId: () => string | null | undefined;
  getOrLoadSession: (
    sessionId: string,
    metadata?: Record<string, unknown>
  ) => Promise<ChatSession | undefined>;
  onModelSwitch: (model: string) => void;
  beginStreamSession: (sessionId: string, model: string) => void;
  getExistingAbort: (sessionId: string) => AbortController | undefined;
  waitForAbortSettled: (
    sessionId: string,
    controller: AbortController
  ) => Promise<void>;
  setAbortController: (sessionId: string, controller: AbortController) => void;
  setExecutionId: (sessionId: string, executionId: string) => void;
  checkpointService: ConstructorParameters<typeof StreamingAutoCheckpoint>[0];
  getOrCreateMutex: (sessionId: string) => SimpleMutex;
  executePreMessageHook: (args: {
    event: string;
    data: { message: string; sessionId: string };
    sessionId: string;
  }) => Promise<{ before: Array<{ data?: unknown }> }>;
  createUserMessage: (
    content: string,
    options: { sessionId: string; metadata?: Record<string, unknown> }
  ) => Message;
  addAndPersistMessage: (sessionId: string, message: Message) => void;
  startProcessing: (sessionId: string) => void;
}

export class ChatStreamSetup {
  constructor(private readonly deps: StreamSetupDeps) {}

  async prepare(
    content: string,
    options?: StreamMessageOptions
  ): Promise<StreamSetupResult> {
    const deps = this.deps;
    // 清理用户输入，防止XSS和隐藏字符攻击
    content = recursivelySanitizeUnicode(content) as string;

    // 验证输入安全性
    const validationResult = securityService.validateInput(content);
    if (!validationResult.valid) {
      logger.warn('用户输入包含敏感数据，已自动脱敏处理', {
        module: 'chat:manager',
        action: 'streamMessage',
      });
      content = securityService.sanitize(content);
      securityService.logSecurityError({
        type: SensitiveErrorType.SENSITIVE_DATA_DETECTED,
        message: '用户输入包含敏感数据，已自动脱敏处理',
      });
    }

    // 获取或创建会话
    const sessionId = options?.sessionId || deps.currentSessionId();
    if (!sessionId) {
      // 与 `ChatOrchestrator.sendMessage` 同口径：缺 `session_id` = 客户端输入错误（VALIDATION），
      // HTTP 边界据此回 400 而非 500（台账 2026-10-27 §10）。
      throw new AppError(
        'No session id provided',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    const session = await deps.getOrLoadSession(sessionId, options?.metadata);
    if (!session) {
      throw new AppError(
        'No session found or created',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 根据实际模型更新 token 预算
    if (options?.model) {
      deps.onModelSwitch(options.model);
    }
    // 设计一（2026-08-26）：流式监测按会话隔离——多会话并发时水位互不覆盖
    deps.beginStreamSession(session.id, options?.model ?? '');

    // 中止同一会话的旧流（P1-4: 确定性等待旧流清理，替代硬编码 100ms）
    const existingAbort = deps.getExistingAbort(session.id);
    if (existingAbort) {
      logger.info('中止同一会话的旧流式请求', { sessionId: session.id });
      existingAbort.abort();
      await deps.waitForAbortSettled(session.id, existingAbort);
    }
    const streamAbortController = new AbortController();
    deps.setAbortController(session.id, streamAbortController);

    // B-05（2026-10-09）：登记本次执行的 `executionId`（按会话）—— 供工具执行器前置记账
    if (options?.executionId) {
      deps.setExecutionId(session.id, options.executionId);
    }

    // PR2（2026-10-09）AbortSignal 端到端贯通：外部 signal（Router/入口注入）**中继**到本会话
    // controller —— abort 外部 ⇒ abort 内部，复用既有内部取消链路（Provider fetch 取消 /
    // ToolRunner 检查 / Agent 桥接）；内部 controller 仍是唯一"会话级"句柄（新请求顶替旧流语义不变）。
    // 外部 signal 随请求生命周期 GC，`once` 监听无需显式摘除。
    const externalSignal = options?.signal;
    if (externalSignal) {
      if (externalSignal.aborted) {
        streamAbortController.abort(externalSignal.reason);
      } else {
        externalSignal.addEventListener(
          'abort',
          () => streamAbortController.abort(externalSignal.reason),
          { once: true }
        );
      }
    }

    // P2-1: 初始化流式自动检查点（局部实例随流式上下文传递，非全局字段）
    const streamingCheckpoint = new StreamingAutoCheckpoint(
      deps.checkpointService,
      session.id
    );

    // 获取会话互斥锁（仅保护工具执行循环，setup 阶段无需锁）
    const mutex = deps.getOrCreateMutex(session.id);

    // 触发 ChatPreMessage Hook
    const preMsgResult = await deps.executePreMessageHook({
      event: 'chat.pre-message',
      data: { message: content, sessionId: session.id },
      sessionId: session.id,
    });
    for (const hr of preMsgResult.before) {
      if (
        hr.data &&
        typeof hr.data === 'object' &&
        'message' in (hr.data as Record<string, unknown>)
      ) {
        content = (hr.data as Record<string, string>).message;
      }
    }

    // 创建用户消息（前端写前落盘后按 id 复用，避免重复持久化）
    let userMessage: Message;
    const prePersisted = options?.messageId
      ? (session.messages.find((m) => m.id === options.messageId) as
          | Message
          | undefined)
      : undefined;
    const prevRoundCount = session.metadata.roundCount ?? 0;
    session.metadata.roundCount = prevRoundCount + 1;
    const fromInternal = options?._fromInternal === true;
    if (!fromInternal) {
      // Buddy 成长：用户发起对话才计数（内部调用不计入，精确"用户真实对话轮数"）
      void import('@modules/buddy')
        .then(({ recordUserSession }) => recordUserSession())
        .catch((err) =>
          logger.warn('Buddy 用户对话轮次埋点失败', { error: String(err) })
        );
    }
    if (fromInternal) {
      // 现场调试断点：内部调用触发时醒目提示（默认日志级别可见）
      logger.info(
        '[内部调用断点] _fromInternal=true，本轮不计入 userSessions',
        {
          sessionId: session.id,
          roundCountFrom: prevRoundCount,
          roundCountTo: session.metadata.roundCount,
          source: options?._fromInternalSource ?? 'unknown',
        }
      );
    }
    logger[fromInternal ? 'debug' : 'info']('用户对话轮次+1（流式）', {
      sessionId: session.id,
      roundCountFrom: prevRoundCount,
      roundCountTo: session.metadata.roundCount,
      model: options?.model ?? null,
      contentLength: content.length,
      prePersisted: !!prePersisted,
      messageId: options?.messageId ?? null,
      _fromInternal: options?._fromInternal ?? false,
      source: fromInternal ? 'internal' : 'user',
    });
    if (prePersisted) {
      userMessage = prePersisted;
    } else {
      userMessage = deps.createUserMessage(content, {
        sessionId: session.id,
        metadata: options?.metadata,
      });
      // AB-14 修复：写前落盘可能失败（断网/后端重启），内存无该 id 时
      // 创建用户消息强制沿用前端 messageId，避免前后端消息 id 漂移。
      // 后端 addMessage 幂等查重会命中同 id，outbox 补发不产生重复。
      if (options?.messageId) {
        userMessage.id = options.messageId;
      }
      deps.addAndPersistMessage(session.id, userMessage);
    }
    deps.startProcessing(session.id);

    // OTel span
    const otel = getOTelTracing();
    const streamSpan = otel.startSpan('chat.streamMessage', {
      'session.id': session.id,
    });

    logger.info('streamMessage:会话准备完成', {
      sessionId: session.id,
      model: options?.model ?? null,
      messageCount: session.messages.length,
      userMessageId: userMessage.id,
      contentLength: content.length,
      hasImages: Array.isArray(options?.images) && options.images.length > 0,
      mutexLocked: false,
    });

    return {
      content,
      session,
      streamAbortController,
      streamingCheckpoint,
      mutex,
      userMessage,
      streamSpan,
    };
  }
}
