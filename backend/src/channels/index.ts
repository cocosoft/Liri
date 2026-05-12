/**
 * channels/ — 通道模块统一入口
 *
 * 当前为过渡期 re-export，实际代码位于 core/gateway/
 * 新代码请从此路径导入。
 */

export {
  ChannelType,
  ChannelStatus,
  MessageDirection,
  ChannelEvent,
} from '../core/gateway/types';

export type {
  InboundMessage,
  OutboundMessage,
  ChannelConfig,
  ChannelEventCallbacks,
  ChannelStats,
  GatewayChannel,
} from '../core/gateway/types';

export {
  ChannelManager,
  createChannelManager,
  getChannelManager,
  disconnectAllChannels,
} from '../core/gateway/ChannelManager';

export type {
  ChannelManagerConfig,
  ChannelManagerStatus,
} from '../core/gateway/ChannelManager';

export { TelegramChannel } from '../core/gateway/TelegramChannel';
export type { TelegramChannelConfig } from '../core/gateway/TelegramChannel';

export { WebChannel } from '../core/gateway/WebChannel';
export type { WebChannelConfig } from '../core/gateway/WebChannel';

export { SlackChannel } from '../core/gateway/SlackChannel';
export type { SlackChannelConfig } from '../core/gateway/SlackChannel';

export { DiscordChannel } from '../core/gateway/DiscordChannel';
export type { DiscordChannelConfig } from '../core/gateway/DiscordChannel';

export { setupGatewayFromConfig } from '../core/gateway/GatewaySetup';
export type { GatewaySetupResult } from '../core/gateway/GatewaySetup';