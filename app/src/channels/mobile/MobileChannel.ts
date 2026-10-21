/**
 * MobileChannel — 移动端**辅助接入**通道（thin client）
 *
 * 定位（2026-10-20 用户裁定，变体矩阵方案 §2.6）：
 * - 移动端**不在本地执行工具**，只承担「会话 / 审批 / 推送」；
 * - 它是**语义适配器**，不新起监听端口：
 *   入站复用 `LocalHTTPService`（统一 Bearer / api-key 鉴权），
 *   出站复用 `/v1/events` SSE（弱网降级轮询由前端负责）。
 *
 * 出站设计：本类只产出**结构化载荷**（`MobileOutboundPayload`），由 `sink` 决定落到哪：
 * - 默认 sink = 动态加载 `LocalHTTPServiceSSE.broadcastEvent`（SSE 首版）；
 * - 可用 `setMobileOutboundSink()` 替换（测试 / 二期系统推送）；
 * - **无可用 sink 时不伪成功**（CS04）：返回 `success:false`，由投递层记录失败。
 *
 * 能力声明：`interactive=false`（首版走文本审批，见 `channels/bridge/TextApprovalParser.ts`）；
 * 权限档位：入站**强制**按 `messaging` 任务面裁剪（不含执行类）—— 本通道属
 * `toolPolicy.ts` 的 `ALWAYS_RESTRICTED_CHANNELS`，**不受** `CHANNEL_TOOL_POLICY` 灰度开关门控
 * （2026-10-20：远程不可信来源，安全约束不能挂在默认关闭的开关上）。
 */

import type {
  ChannelCapabilities,
  ChannelId,
  ChannelMeta,
  IChannelPlugin,
  InteractiveCard,
  MessageContext,
  SendResult,
} from '../types';
import { BaseChannelPlugin } from '../base/BaseChannelPlugin';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('channels:mobile:MobileChannel');

/** 移动端单条文本上限（与 `meta.maxMessageLength` 同源） */
export const MOBILE_MAX_TEXT_LENGTH = 8000;

/** 出站载荷（SSE `event: mobile:message` 的 `data`） */
export interface MobileOutboundPayload {
  event: 'mobile:message';
  /** 会话 ID（= 投递 target，便于前端按会话路由） */
  conversationId: string;
  kind: 'text' | 'markdown' | 'image' | 'file' | 'card';
  /** 渲染/兜底文本；`kind='card'` 时是卡片的纯文本降级（旧前端仍可读） */
  content: string;
  /**
   * `kind='card'` 时**原样**携带卡片 JSON（`InteractiveCard` 唯一形状）。
   *
   * 前端按 `buttons[].value` 决定动作：移动端不新增端点族 ——
   * 预算放行等动作直接打**统一端点**（如 `POST /v1/cost/daily-budget/relief`），
   * 不经过通道入站回调（`变体矩阵方案.md` §2.6 ③）。
   */
  card?: InteractiveCard;
  /** 目标设备（可选；多设备时前端按此过滤） */
  deviceId?: string;
  createdAt: number;
}

/** 出站 sink（同步或异步） */
export type MobileOutboundSink = (
  payload: MobileOutboundPayload
) => void | Promise<void>;

/** 默认 sink：走既有 `/v1/events` SSE 广播（不新起端口） */
async function defaultMobileSink(
  payload: MobileOutboundPayload
): Promise<void> {
  const { broadcastEvent } =
    await import('../../infrastructure/http/LocalHTTPServiceSSE');
  broadcastEvent(payload.event, { ...payload });
}

let sinkOverride: MobileOutboundSink | null = null;

/**
 * 替换出站 sink（测试注入 / 二期系统推送）。
 * 传 `null` 恢复默认（SSE 广播）。
 */
export function setMobileOutboundSink(sink: MobileOutboundSink | null): void {
  sinkOverride = sink;
}

/** 当前生效的 sink（便于诊断 / 测试断言） */
export function getMobileOutboundSink(): MobileOutboundSink {
  return sinkOverride ?? defaultMobileSink;
}

const MOBILE_META: ChannelMeta = {
  id: 'mobile',
  displayName: '移动端（接入）',
  vendor: 'Liri',
  vendorSite: '',
  icon: 'smartphone',
  markdownCapable: true,
  maxMessageLength: MOBILE_MAX_TEXT_LENGTH,
  supportedMessageTypes: ['text', 'markdown'],
};

const MOBILE_CAPABILITIES: ChannelCapabilities = {
  directMessage: true,
  groupMessage: false,
  groupMention: false,
  threading: false,
  reactions: false,
  // 2026-10-21：支持**卡片出站**（SSE 原样携带 `InteractiveCard`）。
  // 入站按钮不走通道回调，而是前端直打统一端点（§2.6 ③）⇒ 无需 `TextApprovalParser` 承接按钮。
  interactive: true,
  voiceCall: false,
  fileUpload: false,
  imageMessage: false,
  webhook: false,
};

export class MobileChannel extends BaseChannelPlugin {
  readonly id: ChannelId = 'mobile';
  readonly meta = MOBILE_META;
  readonly capabilities = MOBILE_CAPABILITIES;

  constructor() {
    super();
    // 传输层鉴权由 `LocalHTTPService`（Bearer / api-key / 登录 token）承担；
    // 通道侧再叠加设备配对与工具面裁剪（`CHANNEL_TOOL_POLICY`）。
    this.security = {
      ...this.security,
      dmPolicy: 'open' as const,
      resolveSender: async (sender: Record<string, unknown>) => ({
        userId: String(sender['deviceId'] ?? 'mobile-device'),
        displayName: String(sender['deviceName'] ?? '移动端'),
        isApproved: true,
      }),
    };
  }

  /** 无平台凭据：移动端不是外部平台，不需要 app secret */
  protected getDefaultConfig(): Record<string, unknown> {
    return { enabled: true };
  }

  protected validateConfig(_config: Record<string, unknown>): string[] {
    return [];
  }

  /** 不新起监听端口：入站由 `LocalHTTPService` 承接 */
  protected async onConnect(_config: Record<string, unknown>): Promise<void> {
    logger.info('移动端通道已就绪（传输复用 LocalHTTPService + /v1/events）');
  }

  protected async sendTextMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    return this.emit(target, 'text', content);
  }

  protected override async sendMarkdownMessage(
    target: string,
    content: string
  ): Promise<SendResult> {
    return this.emit(target, 'markdown', content);
  }

  protected async sendImageMessage(
    target: string,
    imageUrl: string
  ): Promise<SendResult> {
    return this.emit(target, 'image', imageUrl);
  }

  protected async sendFileMessage(
    target: string,
    filePath: string
  ): Promise<SendResult> {
    return this.emit(target, 'file', filePath);
  }

  /**
   * 卡片出站：**原样**把 `InteractiveCard` 放进 SSE `data.card`（§2.6 ②）。
   * `content` 同时给出纯文本降级，未升级的前端也不会空白。
   */
  protected override async sendInteractiveMessage(
    target: string,
    card: InteractiveCard
  ): Promise<SendResult> {
    return this.emit(target, 'card', `${card.title}\n${card.content}`, card);
  }

  /** 由入站层标注当前设备后，出站事件可携带 `deviceId`（多设备定向） */
  setCurrentDeviceId(deviceId: string | undefined): void {
    this._currentDeviceId = deviceId;
  }

  private _currentDeviceId: string | undefined;

  private async emit(
    target: string,
    kind: MobileOutboundPayload['kind'],
    content: string,
    card?: InteractiveCard
  ): Promise<SendResult> {
    const payload: MobileOutboundPayload = {
      event: 'mobile:message',
      conversationId: target,
      kind,
      content,
      ...(card ? { card } : {}),
      createdAt: Date.now(),
      ...(this._currentDeviceId ? { deviceId: this._currentDeviceId } : {}),
    };

    try {
      await getMobileOutboundSink()(payload);
      return { success: true };
    } catch (error) {
      logger.warn('移动端出站失败（不伪成功）', {
        target,
        kind,
        error: String(error),
      });
      return { success: false, error: String(error) };
    }
  }
}

export function createMobileChannel(): IChannelPlugin {
  return new MobileChannel();
}

export const mobileChannelPlugin = createMobileChannel();

/**
 * 入站上下文构造（供 `LocalHTTPService` 的移动端路由复用）。
 *
 * 只做**字段搬运**，不臆造内容；`messageId` 缺失时由调用方补齐（此处不做 mock）。
 */
export function buildMobileMessageContext(input: {
  deviceId: string;
  conversationId: string;
  text: string;
  messageId: string;
  timestamp?: number;
}): MessageContext {
  return {
    channelId: 'mobile',
    senderId: input.deviceId,
    senderName: input.deviceId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    messageType: 'text',
    content: input.text,
    timestamp: input.timestamp ?? Date.now(),
    isDirectMessage: true,
    rawPayload: {
      channel: 'mobile',
      deviceId: input.deviceId,
    },
  };
}

/** 入站请求体（`POST /v1/channels/mobile/messages`）的标准化结果 */
export interface MobileInboundInput {
  deviceId: string;
  conversationId: string;
  text: string;
  messageId?: string;
}

export type MobileInboundParse =
  | { ok: true; value: MobileInboundInput }
  | { ok: false; error: string };

/**
 * 校验并归一移动端入站请求体（**纯函数**，边界校验的唯一入口）。
 *
 * 口径：
 * - `deviceId` 必填（身份维度；后续批次接设备配对短 token）；
 * - `text` 必填、去首尾空白后非空、长度 ≤ {@link MOBILE_MAX_TEXT_LENGTH}；
 * - `conversationId` 缺省 ⇒ 回落到 `deviceId`（DM 语义，不臆造新 id）；
 * - `messageId` 可选（缺省由 handler 生成 UUID，见 `handleMobileInboundMessage`）。
 */
export function parseMobileInboundBody(raw: unknown): MobileInboundParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const body = raw as Record<string, unknown>;

  const deviceId =
    typeof body['deviceId'] === 'string' ? body['deviceId'].trim() : '';
  if (!deviceId) return { ok: false, error: 'deviceId is required' };

  const text = typeof body['text'] === 'string' ? body['text'].trim() : '';
  if (!text) return { ok: false, error: 'text is required' };
  if (text.length > MOBILE_MAX_TEXT_LENGTH) {
    return {
      ok: false,
      error: `text exceeds ${MOBILE_MAX_TEXT_LENGTH} characters`,
    };
  }

  const conversationRaw = body['conversationId'];
  const conversationId =
    typeof conversationRaw === 'string' && conversationRaw.trim()
      ? conversationRaw.trim()
      : deviceId;

  const messageRaw = body['messageId'];
  const messageId =
    typeof messageRaw === 'string' && messageRaw.trim()
      ? messageRaw.trim()
      : undefined;

  return {
    ok: true,
    value: {
      deviceId,
      conversationId,
      text,
      ...(messageId ? { messageId } : {}),
    },
  };
}
