/**
 * plugin-sdk/channel-contract.ts — 通道插件 SDK 契约
 *
 * 第三方通道插件开发者通过此模块了解 IChannelPlugin 的完整接口契约。
 * 对齐 OpenClaw plugin-sdk/channel-contract.ts
 *
 * 边界红线：此文件不引用 src/ 下的任何模块。
 */

// ─── 通道元数据 ───

export type ChannelId =
  | 'wecom'
  | 'feishu'
  | 'dingtalk'
  | 'wechat'
  | 'qq'
  | 'telegram'
  | 'discord'
  | string;

export interface ChannelMeta {
  id: ChannelId;
  displayName: string;
  vendor: string;
  vendorSite: string;
  icon: string;
  markdownCapable: boolean;
  maxMessageLength: number;
  supportedMessageTypes: ('text' | 'image' | 'file' | 'markdown' | 'card')[];
}

export interface ChannelCapabilities {
  directMessage: boolean;
  groupMessage: boolean;
  groupMention: boolean;
  threading: boolean;
  reactions: boolean;
  interactive: boolean;
  voiceCall: boolean;
  fileUpload: boolean;
  imageMessage: boolean;
  webhook: boolean;
}

// ─── 通道接口契约 ───

export interface ChannelConfigAdapter {
  validate: (config: Record<string, unknown>) => {
    valid: boolean;
    errors: string[];
  };
  getDefaultConfig: () => Record<string, unknown>;
}

export interface ChannelLifecycleAdapter {
  connect: (config: Record<string, unknown>) => Promise<void>;
  disconnect: () => Promise<void>;
  healthCheck: () => Promise<{ healthy: boolean; latencyMs: number }>;
  getStatus: () => ChannelStatus;
}

export interface ChannelOutboundAdapter {
  sendText: (target: string, content: string) => Promise<ChannelSendResult>;
  sendMarkdown: (target: string, content: string) => Promise<ChannelSendResult>;
  sendImage: (target: string, imageUrl: string) => Promise<ChannelSendResult>;
  sendFile: (target: string, filePath: string) => Promise<ChannelSendResult>;
  sendInteractive: (
    target: string,
    card: ChannelInteractiveCard
  ) => Promise<ChannelSendResult>;
}

export interface ChannelSecurityAdapter {
  dmPolicy: 'pairing' | 'allowlist' | 'open';
  allowFrom?: string[];
  pairingCodeTimeoutMs: number;
  maxPairingAttempts: number;
  resolveSender: (
    sender: Record<string, unknown>
  ) => Promise<{ userId: string; displayName: string; isApproved: boolean }>;
  authorizeMessage: (
    ctx: ChannelMessageContext
  ) => Promise<{ allowed: boolean; reason?: string }>;
}

export interface ChannelPairingAdapter {
  generatePairingCode: (userId: string) => Promise<string>;
  validatePairingCode: (userId: string, code: string) => Promise<boolean>;
  listApprovedUsers: () => Promise<string[]>;
  removeApprovedUser: (userId: string) => Promise<void>;
}

export interface IChannelPlugin {
  readonly id: ChannelId;
  readonly meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  config: ChannelConfigAdapter;
  lifecycle: ChannelLifecycleAdapter;
  outbound: ChannelOutboundAdapter;
  security: ChannelSecurityAdapter;
  pairing?: ChannelPairingAdapter;
}

// ─── 辅助类型 ───

export interface ChannelStatus {
  connected: boolean;
  latencyMs: number;
  lastMessageAt: number | null;
  uptimeMs: number;
  error?: string;
}

export interface ChannelSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  latencyMs?: number;
}

export interface ChannelInteractiveCard {
  title: string;
  content: string;
  buttons?: Array<{
    text: string;
    value: string;
    style?: 'primary' | 'default' | 'danger';
  }>;
  color?: 'green' | 'yellow' | 'red' | 'blue' | 'grey';
}

export interface ChannelMessageContext {
  channelId: ChannelId;
  senderId: string;
  senderName?: string;
  groupId?: string;
  conversationId?: string;
  messageId: string;
  messageType: 'text' | 'image' | 'file' | 'voice' | 'event' | 'unknown';
  content: string;
  timestamp: number;
  isDirectMessage: boolean;
  rawPayload: Record<string, unknown>;
}

// ─── 通道插件构建辅助 ───

export function validateChannelPlugin(plugin: IChannelPlugin): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!plugin.id) errors.push('缺少 id');
  if (!plugin.meta) {
    errors.push('缺少 meta');
  } else {
    if (!plugin.meta.id) errors.push('meta.id 不能为空');
    if (!plugin.meta.displayName) errors.push('meta.displayName 不能为空');
  }
  if (!plugin.capabilities) errors.push('缺少 capabilities');
  if (!plugin.config) errors.push('缺少 config adapter');
  if (!plugin.lifecycle) errors.push('缺少 lifecycle adapter');
  if (!plugin.outbound) errors.push('缺少 outbound adapter');
  if (!plugin.security) errors.push('缺少 security adapter');

  return { valid: errors.length === 0, errors };
}
