/**
 * ChannelPlugin — 通道插件接口
 * 定义通道插件化注册标准，所有通道适配器需同时实现此接口
 * 与 GatewayChannel 互补：GatewayChannel 面向传输层，ChannelPlugin 面向注册管理层
 */

import type { GatewayChannel, InboundMessage, OutboundMessage } from './types';
import { ChannelStatus, MessageDirection } from './types';

/** 通道能力声明 */
export interface ChannelCapabilities {
  /** 支持的消息类型 */
  messageTypes: Array<'text' | 'markdown' | 'html'>;
  /** 支持媒体上传 */
  supportsMedia: boolean;
  /** 最大消息长度（字符数，0 表示无限制） */
  maxMessageLength: number;
  /** 支持的消息方向 */
  directions: MessageDirection[];
  /** 通道特性标记列表 */
  features: string[];
}

/** 通道插件配置验证结果 */
export interface PluginValidationResult {
  /** 是否通过验证 */
  valid: boolean;
  /** 错误信息列表（valid=true 时为空数组） */
  errors: string[];
}

/**
 * 通道插件接口
 * 所有通过 ChannelPluginRegistry 注册的通道必须实现此接口
 */
export interface ChannelPlugin {
  /** 插件唯一标识（用于注册表查找） */
  readonly id: string;

  /** 当前状态 */
  readonly status: ChannelStatus;

  /** 通道能力声明 */
  readonly capabilities: ChannelCapabilities;

  /** 连接通道 */
  connect(): Promise<void>;

  /** 断开通道 */
  disconnect(): Promise<void>;

  /**
   * 处理入站消息
   * 通道从外部接收消息后，通过此方法交给系统处理
   */
  handleInbound(message: InboundMessage): Promise<void>;

  /**
   * 处理出站消息
   * 系统发送消息到外部时，通过此方法交给通道发送
   */
  handleOutbound(message: OutboundMessage): Promise<boolean>;

  /** 获取通道能力 */
  getCapabilities(): ChannelCapabilities;

  /** 验证通道配置，返回错误列表 */
  validateConfig(): PluginValidationResult;
}

/**
 * 类型守卫：判断一个对象是否实现了 ChannelPlugin 接口
 * 用于 ChannelManager 统一注册时发现同时实现 ChannelPlugin 的通道
 */
export function isChannelPlugin(
  obj: GatewayChannel | unknown
): obj is ChannelPlugin {
  if (!obj || typeof obj !== 'object') {
    return false;
  }
  const candidate = obj as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.validateConfig === 'function' &&
    typeof candidate.getCapabilities === 'function' &&
    typeof candidate.handleInbound === 'function' &&
    typeof candidate.handleOutbound === 'function'
  );
}
