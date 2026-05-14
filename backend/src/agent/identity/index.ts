/**
 * Agent Identity
 * 对标 OpenClaw agents/identity.ts
 * 代理身份系统：名称前缀、确认反应、消息前缀、人工延迟配置
 */

/**
 * 标识配置
 */
export interface IdentityConfig {
  /** 代理名称 */
  name?: string;
  /** 头像 emoji */
  emoji?: string;
}

/**
 * 消息配置
 */
export interface MessagesConfig {
  /** 确认反应 emoji */
  ackReaction?: string;
  /** 消息前缀 */
  messagePrefix?: string;
  /** 响应前缀 */
  responsePrefix?: string;
}

/**
 * 人工延迟配置
 */
export interface HumanDelayConfig {
  /** 延迟模式 */
  mode?: 'off' | 'fixed' | 'range' | 'auto';
  /** 最小延迟(ms) */
  minMs?: number;
  /** 最大延迟(ms) */
  maxMs?: number;
}

/**
 * 代理身份总配置
 */
export interface AgentIdentitySystemConfig {
  /** 代理标识配置，按 agentId 索引 */
  agents?: Record<string, IdentityConfig>;
  /** 全局消息配置 */
  messages?: MessagesConfig;
  /** 渠道配置 */
  channels?: Record<string, {
    ackReaction?: string;
    responsePrefix?: string;
    accounts?: Record<string, {
      ackReaction?: string;
      responsePrefix?: string;
    }>;
  }>;
  /** 代理默认值 */
  defaults?: {
    identity?: IdentityConfig;
    humanDelay?: HumanDelayConfig;
  };
}

const DEFAULT_ACK_REACTION = '\u{1F440}';

/**
 * 解析指定代理的身份配置
 */
export function resolveAgentIdentity(
  config: AgentIdentitySystemConfig,
  agentId: string,
): IdentityConfig | undefined {
  return config.agents?.[agentId] ?? config.defaults?.identity;
}

/**
 * 解析确认反应 emoji
 * 优先级: 渠道账户 → 渠道 → 全局消息 → 代理身份 emoji → 默认
 */
export function resolveAckReaction(
  config: AgentIdentitySystemConfig,
  agentId: string,
  opts?: { channel?: string; accountId?: string },
): string {
  if (opts?.channel && opts?.accountId) {
    const accountReaction = config.channels?.[opts.channel]?.accounts?.[opts.accountId]?.ackReaction;
    if (accountReaction !== undefined) {
      return accountReaction.trim();
    }
  }

  if (opts?.channel) {
    const channelReaction = config.channels?.[opts.channel]?.ackReaction;
    if (channelReaction !== undefined) {
      return channelReaction.trim();
    }
  }

  const globalReaction = config.messages?.ackReaction;
  if (globalReaction !== undefined) {
    return globalReaction.trim();
  }

  const emoji = resolveAgentIdentity(config, agentId)?.emoji?.trim();
  return emoji || DEFAULT_ACK_REACTION;
}

/**
 * 解析身份名称前缀
 */
export function resolveIdentityNamePrefix(
  config: AgentIdentitySystemConfig,
  agentId: string,
): string | undefined {
  const name = resolveAgentIdentity(config, agentId)?.name?.trim();
  if (!name) {
    return undefined;
  }
  return `[${name}]`;
}

/**
 * 解析消息前缀
 */
export function resolveMessagePrefix(
  config: AgentIdentitySystemConfig,
  agentId: string,
  opts?: { configured?: string; hasAllowFrom?: boolean; fallback?: string },
): string {
  const configured = opts?.configured ?? config.messages?.messagePrefix;
  if (configured !== undefined) {
    return configured;
  }

  if (opts?.hasAllowFrom === true) {
    return '';
  }

  return resolveIdentityNamePrefix(config, agentId) ?? opts?.fallback ?? '[agent]';
}

/**
 * 解析响应前缀
 */
export function resolveResponsePrefix(
  config: AgentIdentitySystemConfig,
  agentId: string,
  opts?: { channel?: string; accountId?: string },
): string | undefined {
  if (opts?.channel && opts?.accountId) {
    const accountPrefix = config.channels?.[opts.channel]?.accounts?.[opts.accountId]?.responsePrefix;
    if (accountPrefix !== undefined) {
      if (accountPrefix === 'auto') {
        return resolveIdentityNamePrefix(config, agentId);
      }
      return accountPrefix;
    }
  }

  if (opts?.channel) {
    const channelPrefix = config.channels?.[opts.channel]?.responsePrefix;
    if (channelPrefix !== undefined) {
      if (channelPrefix === 'auto') {
        return resolveIdentityNamePrefix(config, agentId);
      }
      return channelPrefix;
    }
  }

  const globalPrefix = config.messages?.responsePrefix;
  if (globalPrefix !== undefined) {
    if (globalPrefix === 'auto') {
      return resolveIdentityNamePrefix(config, agentId);
    }
    return globalPrefix;
  }

  return undefined;
}

/**
 * 解析有效消息配置（合并消息前缀和响应前缀）
 */
export function resolveEffectiveMessagesConfig(
  config: AgentIdentitySystemConfig,
  agentId: string,
  opts?: {
    hasAllowFrom?: boolean;
    fallbackMessagePrefix?: string;
    channel?: string;
    accountId?: string;
  },
): { messagePrefix: string; responsePrefix?: string } {
  return {
    messagePrefix: resolveMessagePrefix(config, agentId, {
      hasAllowFrom: opts?.hasAllowFrom,
      fallback: opts?.fallbackMessagePrefix,
    }),
    responsePrefix: resolveResponsePrefix(config, agentId, {
      channel: opts?.channel,
      accountId: opts?.accountId,
    }),
  };
}

/**
 * 解析人工延迟配置
 * 合并全局默认值和代理特定覆盖
 */
export function resolveHumanDelayConfig(
  config: AgentIdentitySystemConfig,
  agentId: string,
): HumanDelayConfig | undefined {
  const defaults = config.defaults?.humanDelay;
  const agentIdentity = resolveAgentIdentity(config, agentId);
  const overrides = agentIdentity as HumanDelayConfig | undefined;

  if (!defaults && !overrides) {
    return undefined;
  }

  return {
    mode: overrides?.mode ?? defaults?.mode,
    minMs: overrides?.minMs ?? defaults?.minMs,
    maxMs: overrides?.maxMs ?? defaults?.maxMs,
  };
}
