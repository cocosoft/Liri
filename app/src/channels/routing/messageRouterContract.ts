// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// messageRouter 契约：对外类型 + 路由常量（自 `messageRouter.ts` **纯搬迁**，2026-10-09 C3-S3）
// 见 `.trae/specs/message-router-split.md`。

import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI';
import type { RequestPriority } from '@modules/types/requestPriority';
import type { DmPolicyConfig } from '../policy/DmPolicy';

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
      /** P26-1 §9.1（2026-10-07）：请求优先级（渠道入站传 `background`） */
      priority?: RequestPriority;
      /** PR1（2026-10-09）：执行标识（Execution 生命周期归属；见 spec） */
      executionId?: string;
      /** PR2（2026-10-09）：外部取消信号（端到端贯通 Router → CoreAPI → ChatManager） */
      signal?: AbortSignal;
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

/** 消息大小上限（默认 1MB） */
export const MAX_MESSAGE_SIZE = 1 * 1024 * 1024;

/** messageId 级去重 TTL（毫秒） */
export const DEDUP_TTL_MS = 3000;

/** 内容级去重窗口（毫秒） */
export const CONTENT_DEDUP_WINDOW_MS = 5000; // 5 秒内容去重窗口

/** 流式空转（无 chunk）超时（毫秒）——活动心跳语义，长任务持续推进则不被掐断 */
export const STREAM_IDLE_TIMEOUT_MS = 300_000;

/**
 * AC-5③（2026-08-20）：长任务占位提示阈值。QQ 等渠道被动回复窗口约 5 分钟，
 * 任务超窗后最终回复会被渠道拒收；超过本阈值仍未完成时先推送一条占位提示
 * （走一次被动回复，msg_seq 由渠道侧递增管理），最终结果超窗时由渠道侧
 * 降级主动消息送达。
 */
export const LONG_TASK_PLACEHOLDER_AFTER_MS = 240_000; // 4 分钟（留 1 分钟窗口余量）

/**
 * PR2（2026-10-09）：两段式取消的 grace 窗口。空转超时后 `CANCEL_REQUESTED` + `abort()`
 * （端到端信号），最多等待本时长确认底层生成器已停止：确认 ⇒ `CANCELLED`；
 * 未确认 ⇒ **保留 lease**（不释放 session 所有权，后续消息排队，不启动下一次）。
 * 由灰度开关 `EXECUTION_TWO_PHASE_CANCEL` 门控。
 */
export const CANCEL_GRACE_MS = 5000;

/**
 * PR2 遗留-2（2026-10-09）：Router 级**准入**的等待上限与轮询间隔。
 *
 * 若本执行以 `QUEUED` 创建（该会话仍被上次"未确认取消"的执行占用），则**不并发启动**本次 LLM
 * 调用（"绝不双 RUNNING" / 验收 ⑤ 的"E2 不能起"）：最多等待本时长以取得所有权；超时 ⇒
 * **放弃本次执行**（不启动 LLM、不标记已处理 ⇒ 允许渠道重试）。由 `EXECUTION_TWO_PHASE_CANCEL` 门控。
 */
export const SESSION_ADMISSION_WAIT_MS = 30_000;
export const ADMISSION_POLL_MS = 100;
