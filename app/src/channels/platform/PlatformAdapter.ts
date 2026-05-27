/**
 * PlatformAdapter — 平台适配器接口
 *
 * 对标 Hermes gateway/platforms/base.py BasePlatformAdapter ABC：
 * - setup() / handle_message() / send() 核心三方法
 * - 消息类型枚举 + 处理结果封装
 *
 * 本接口定位在 add-platform-channel.md 中已有约定，但此前未在代码中
 * 落地。现有 IChannelPlugin (5 Adapter) 体系功能完备但门槛较高，新开
 * 发者实现完整的 IChannelPlugin + BaseChannelPlugin 需理解多处抽象。
 *
 * PlatformAdapter 提供一条更轻量的接入路径：
 * - 仅需实现 setup / handleMessage / sendMessage 三个方法
 * - 通过 PlatformAdapterBridge 自动适配为完整 IChannelPlugin
 */

import type {
  ChannelId,
  SendResult,
  ChannelMeta,
  ChannelCapabilities,
} from '@modules/channels/types';

/**
 * 消息事件 — 从平台接收到的输入消息
 */
export interface PlatformMessageEvent {
  /** 会话/对话 ID */
  conversationId: string;

  /** 发送者 ID */
  senderId: string;

  /** 发送者显示名称 */
  senderName?: string;

  /** 群组 ID（群消息时设置） */
  groupId?: string;

  /** 消息 ID */
  messageId: string;

  /** 消息文本内容 */
  text: string;

  /** 消息时间戳（毫秒） */
  timestamp: number;

  /** 是否为私聊 */
  isDirectMessage: boolean;

  /** 回复的目标消息 ID（线程回复时设置） */
  replyToId?: string;

  /** 平台原始数据 */
  rawPayload: Record<string, unknown>;
}

/**
 * 消息类型
 */
export type PlatformMessageType = 'text' | 'image' | 'file' | 'voice' | 'event';

/**
 * 消息处理结果
 */
export interface PlatformProcessingOutcome {
  /** 是否已处理 */
  handled: boolean;

  /** 响应文本（可选） */
  reply?: string;
}

/**
 * PlatformAdapter — 平台适配器接口
 *
 * 第三方开发者实现此接口即可接入新平台，无需理解 IChannelPlugin 的
 * 5 Adapter 体系。PlatformAdapterBridge 会自动完成适配。
 *
 * @example
 * ```typescript
 * class MyPlatformAdapter extends BasePlatformAdapter {
 *   readonly name = 'myplatform';
 *   readonly type = 'myplatform';
 *
 *   async setup(config: Record<string, unknown>): Promise<void> {
 *     // 初始化 SDK 连接
 *   }
 *
 *   async handleMessage(event: PlatformMessageEvent): Promise<PlatformProcessingOutcome> {
 *     // 处理接收到的消息
 *     return { handled: true, reply: '已收到' };
 *   }
 *
 *   async sendMessage(target: string, text: string): Promise<boolean> {
 *     // 发送消息到平台
 *     return true;
 *   }
 * }
 * ```
 */
export interface PlatformAdapter {
  /** 适配器名称 */
  readonly name: string;

  /** 平台类型标识符 */
  readonly type: ChannelId;

  /** 是否已连接 */
  readonly connected: boolean;

  /** 是否启用 */
  readonly enabled: boolean;

  /** 初始化并建立平台连接 */
  setup(config: Record<string, unknown>): Promise<void>;

  /** 断开平台连接 */
  teardown(): Promise<void>;

  /** 处理来自平台的消息（平台→Agent） */
  handleMessage(
    event: PlatformMessageEvent
  ): Promise<PlatformProcessingOutcome>;

  /** 向平台发送消息（Agent→平台） */
  sendMessage(target: string, text: string): Promise<boolean>;

  /** 获取平台适配器状态 */
  getStatus(): Record<string, unknown>;

  /** 原始适配器实例引用（用于向下兼容） */
  readonly rawAdapter?: unknown;
}

/**
 * BasePlatformAdapter — 平台适配器抽象基类
 *
 * 提供标准默认实现，子类仅需实现 setup / handleMessage / sendMessage。
 */
export abstract class BasePlatformAdapter implements PlatformAdapter {
  abstract readonly name: string;
  abstract readonly type: ChannelId;

  protected _connected = false;
  protected _enabled = true;

  get connected(): boolean {
    return this._connected;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  abstract setup(config: Record<string, unknown>): Promise<void>;

  async teardown(): Promise<void> {
    this._connected = false;
  }

  abstract handleMessage(
    event: PlatformMessageEvent
  ): Promise<PlatformProcessingOutcome>;

  abstract sendMessage(target: string, text: string): Promise<boolean>;

  getStatus(): Record<string, unknown> {
    return {
      name: this.name,
      type: this.type,
      connected: this._connected,
      enabled: this._enabled,
    };
  }

  get rawAdapter(): unknown {
    return undefined;
  }
}
