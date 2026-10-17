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
      /**
       * T1-6（通道治理 §1.3 收口，2026-10-13）：**入站附件的字节口径**（供 R16 日预算预留）。
       *
       * **仅取 `size`**（与 `query/attachmentBudget.estimateAttachmentsTokens` 的结构化入参同形）；
       * **不**复用 `images`（后者是多模态载体，消费方读 `img.path`，见 `StreamPipeline.ts`）⇒
       * 避免把通道附件污染为模型图片输入。⚠️ 通道协议层 `MessageAttachment` 与会话领域层
       * **同名不同物**（`enums.ts:142-145`）⇒ 跨层只做**显式适配**（不互换类型）。
       */
      attachmentSizes?: readonly { size?: number }[];
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

// ─── 入站 DTO 标准化（阶段 2.4）─────────────────────────

/** 入站载荷类型（**标准化口径**：仅 2 类；媒体/语音等一律归 `file`，语义细节留在 `attachments`） */
export type InboundPayloadType = 'text' | 'file';

/** 标准化附件元数据（**统一形状**：出入站共用；不承载平台私有字段） */
export interface InboundAttachmentDto {
  /** 语义类型（如 mime 主类型 / `image` / `voice`；无法判定 ⇒ `file`） */
  type: string;
  /** 远程 URL（未下载时） */
  url?: string;
  /** 本地路径（已落盘时；未落盘 ⇒ 省略，**不臆造**） */
  path?: string;
  /** 原始文件名 */
  name?: string;
  /** 字节数（缺省 ⇒ 省略；下游预算折算按 0 计） */
  size?: number;
}

/**
 * **标准化入站信封**（阶段 2.4）——主内核与外部通道插件之间的**唯一入站形状**。
 *
 * 口径：`{ sessionId?, messageId, platform, payload:{type,content,attachments?}, sender:{platform,userId}, receivedAt }`。
 * `sessionId` 在**入站阶段尚未知**（由路由/会话复用决定）⇒ 可选。
 */
export interface InboundEnvelope {
  /** 会话 ID（入站时未知 ⇒ 省略，由路由侧决定后回填） */
  sessionId?: string;
  /** 平台消息 ID（用于去重/追踪） */
  messageId: string;
  /** 平台标识（= 通道 id，如 `telegram`） */
  platform: string;
  payload: {
    type: InboundPayloadType;
    content: string;
    attachments?: InboundAttachmentDto[];
  };
  sender: {
    platform: string;
    userId: string;
  };
  /** 平台侧时间戳（epoch ms） */
  receivedAt: number;
}

/** `MessageContext.messageType` → 标准化载荷类型（媒体/语音/事件一律以文本承载或走 attachments） */
function toPayloadType(messageType: string): InboundPayloadType {
  return messageType === 'text' ? 'text' : 'file';
}

/**
 * `MessageContext`（**通道协议层**）→ `InboundEnvelope`（**标准化入站 DTO**）纯函数。
 *
 * 说明：本函数只做**形状归一**（不改语义、不落盘、不发网络）；是"入站 DTO 标准化"的单一转换点。
 * 未来进程外通道插件亦产出 `InboundEnvelope`，从而**共用同一条入站管线**。
 */
export function toInboundEnvelope(ctx: {
  channelId: string;
  senderId: string;
  messageId: string;
  messageType: string;
  content: string;
  timestamp: number;
  attachments?: ReadonlyArray<{
    fileName?: string;
    mimeType?: string;
    url?: string;
    size?: number;
  }>;
}): InboundEnvelope {
  const attachments =
    ctx.attachments && ctx.attachments.length > 0
      ? ctx.attachments.map((a) => {
          const dto: InboundAttachmentDto = {
            type: a.mimeType ?? 'file',
          };
          if (a.url) dto.url = a.url;
          if (a.fileName) dto.name = a.fileName;
          if (typeof a.size === 'number') dto.size = a.size;
          return dto;
        })
      : undefined;

  const envelope: InboundEnvelope = {
    messageId: ctx.messageId,
    platform: ctx.channelId,
    payload: {
      type: toPayloadType(ctx.messageType),
      content: ctx.content,
    },
    sender: { platform: ctx.channelId, userId: ctx.senderId },
    receivedAt: ctx.timestamp,
  };
  if (attachments) envelope.payload.attachments = attachments;
  return envelope;
}

/** 消息大小上限（默认 1MB） */
export const MAX_MESSAGE_SIZE = 1 * 1024 * 1024;

/** messageId 级去重 TTL（毫秒） */
export const DEDUP_TTL_MS = 3000;

/** 内容级去重窗口（毫秒） */
export const CONTENT_DEDUP_WINDOW_MS = 5000; // 5 秒内容去重窗口

/** 流式空转（无 chunk）超时（毫秒）——活动心跳语义，长任务持续推进则不被掐断
 *  B5-2㊶：本处为 STREAM_IDLE_TIMEOUT_MS 唯一真源（app 域消息路由契约，架构收容地）；
 *  client 侧副本已按域消歧改名 SSE_IDLE_TIMEOUT_MS（client/app 异域双轨，参照裁定 A 不可跨轨合一） */
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

/**
 * 通道侧 LLM 失败回执（出站文案 + 回给上层的码/简述）。
 *
 * G-2/C（2026-10-11，Spec `daily-budget-over-limit-ux.md` §5-D-1 C / Review Focus #4）：
 * 渠道用户**看不到**桌面端的限额卡片、也没有可点的按钮 ⇒ 撞限必须把**原因 + 出路**
 * 写进回复正文；否则只能收到"消息处理失败"（当前痛点）。
 *
 * 通道侧无 i18n 基建（既有文案均为硬编码中文）⇒ 收敛为**唯一文案表**，避免散落各处。
 */
export interface ChannelLlmFailure {
  /** 出站给用户的文案 */
  outbound: string;
  /** 返回给上层的业务码（保留真实码，便于调用方/审计分流） */
  errorCode: string;
  /** 返回给上层的简述 */
  errorMessage: string;
}

/** 通用失败（**既有文案逐字保留**，防回归） */
const GENERIC_LLM_FAILURE: ChannelLlmFailure = {
  outbound: '⚠️ 消息处理失败，请稍后重发重试。',
  errorCode: 'LLM_ERROR',
  errorMessage: '消息处理失败，请稍后重试',
};

/**
 * 撞限专用文案（D-g/C）：说明**原因**（今日**金额**预算耗尽、本次未调用模型）并给出**出路**
 * （桌面端「用量中心 → 日限额」放行后重发）。放行口径与桌面端一致（D-b：临时提额 / 今日解除）。
 *
 * ⚠️ 2026-10-15：闸门已切**金额口径**（Token 轨只观测、不启用闸门）⇒ 文案不再称「Token 预算」，
 * 否则用户会去调 Token 观测阈值而非「金额上限」，改不到点上。
 */
const BUDGET_EXCEEDED_FAILURE: ChannelLlmFailure = {
  outbound:
    '⚠️ 今日金额预算已用完，为避免超支，本次未调用模型。\n' +
    '放行后重发本条消息即可继续：在 Liri 桌面端「用量中心 → 日限额」临时提额、今日解除，或调高「金额上限」。',
  errorCode: 'DAILY_BUDGET_EXCEEDED',
  errorMessage:
    '今日金额预算已用完（可在桌面端「用量中心 → 日限额」放行后重试）',
};

/**
 * **运行中被挂起**专用文案（2026-10-17，Spec `channel-budget-inline-relief.md` §D1）。
 *
 * ⚠️ 与上面的「**发送被拦**」是**两种语义**，**不得**共用一句：
 *  - 发送被拦（`BUDGET_EXCEEDED_FAILURE`）= 本条消息**未被处理** ⇒ 放行后**重发**即可；
 *  - 运行中被挂起（本函数）= 会话已跑到一半、**进度已保存** ⇒ 放行后**自动续跑、无需重发**。
 *
 * 两者混淆的代价是**做错动作**（该重发时没重发、该等待时重复重发 ⇒ 重复执行）。
 *
 * `hasButtons`：本次是否**真的**发出了「就地放行」按钮（由 `channels/bridge/budgetReliefCard`
 * 按实际投递路径传入）—— 无按钮（QQ 未开通自定义按钮、或已降级）时**不得**说"点下方按钮"。
 */
export function buildBudgetSuspendedNotice(args: {
  hasButtons: boolean;
}): string {
  const head = '⏸ 今日金额预算已用完，本轮**进度已保存**（不是失败）。\n';
  const tail = args.hasButtons
    ? '点下方「临时提额」或「今日解除」放行，本会话会**自动从这里续跑，无需重发消息**。'
    : '放行后本会话会**自动从这里续跑，无需重发消息**；放行入口在 Liri 桌面端「用量中心 → 日限额」（临时提额 / 今日解除）。';
  return head + tail;
}

/**
 * 内核在**挂起收尾**时追加到正文末尾的提示块**起始标记**（`ReActToolLoop.resolveTerminationOutput` 写入）。
 *
 * ⚠️ 契约：改那段文案时**必须保留**行首的 `⏸` —— 通道侧据此把「模型正文」与「挂起提示」分开
 * （发卡成功时避免同一条信息发两遍，见 `messageRouter` 的挂起分支）。
 */
export const SUSPENSION_NOTICE_MARKER = '⏸';

/**
 * 把「模型正文」与「内核追加的挂起提示块」分开（**纯函数**）。
 *
 * 为什么需要：运行中被预算挂起时，正文 = 模型已产出的文字 + 内核追加的 `⏸ …` 提示；而通道侧
 * 会再发一张「就地放行」卡片（文案同源）⇒ 真机实测（2026-10-17 09:56，QQ）**同一条信息发了两遍**。
 * 发卡成功后剥掉提示块，只留模型正文（为空则不再发文本）。
 *
 * 判定只看**结构标记**（首行 `⏸` 或 `\n\n⏸` 起头），不解析文案内容。
 */
export function splitSuspensionNotice(content: string): {
  body: string;
  notice: string;
} {
  const text = content ?? '';
  const trimmedStart = text.trimStart();
  if (trimmedStart.startsWith(SUSPENSION_NOTICE_MARKER)) {
    return { body: '', notice: trimmedStart };
  }
  const at = text.indexOf(`\n\n${SUSPENSION_NOTICE_MARKER}`);
  if (at < 0) return { body: text, notice: '' };
  return { body: text.slice(0, at), notice: text.slice(at).trim() };
}

/**
 * 去掉 Markdown 粗体标记（**纯函数**）。
 *
 * 为什么需要：QQ 的纯文本发送（`sendText`）不渲染 Markdown ⇒ 真机截图里「**本轮进度已保存**」
 * 带着星号露出。仅在**纯文本承载**的路径（卡片发送失败/通道不支持按钮）使用；走 Markdown 的
 * 通道保持原样。
 */
export function stripBoldMarkers(text: string): string {
  return (text ?? '').replace(/\*\*/g, '');
}

/**
 * 决定「挂起」分支**还要不要发正文**（**纯函数**，供单测钉住两条分支）。
 *
 * @returns `null` = 卡片已承载全部信息且正文无额外内容 ⇒ **跳过文本投递**
 *          （否则同一条信息发两遍）；否则为「应当投递的正文」。
 *
 *  - 发卡**成功** ⇒ 剥掉内核追加的提示块（与卡片同源），只留模型正文；
 *  - 发卡**失败** ⇒ 文本必须承载出路；纯文本通道不渲染 Markdown ⇒ 去掉 `**`。
 */
export function resolveSuspendedOutboundContent(args: {
  cardSent: boolean;
  content: string;
}): string | null {
  if (args.cardSent) {
    const { body } = splitSuspensionNotice(args.content);
    return body.trim() ? body : null;
  }
  return stripBoldMarkers(args.content);
}

/**
 * 解析 LLM 失败回执（纯函数，便于单测）。
 *
 * 仅 `DAILY_BUDGET_EXCEEDED` 走限额文案；其余（含无码 / `LLM_ERROR`）保持既有通用兜底 ⇒ **不回归**。
 */
export function resolveLlmFailure(streamErrorCode?: string): ChannelLlmFailure {
  return streamErrorCode === 'DAILY_BUDGET_EXCEEDED'
    ? BUDGET_EXCEEDED_FAILURE
    : GENERIC_LLM_FAILURE;
}
