/**
 * Gateway 通道模块统一入口
 */

export {
  ChannelType,
  ChannelStatus,
  MessageDirection,
  ChannelEvent,
} from './types';

export type {
  InboundMessage,
  OutboundMessage,
  ChannelConfig,
  ChannelEventCallbacks,
  ChannelStats,
  GatewayChannel,
} from './types';

export {
  ChannelManager,
  createChannelManager,
  getChannelManager,
  disconnectAllChannels,
} from './ChannelManager';

export type {
  ChannelManagerConfig,
  ChannelManagerStatus,
} from './ChannelManager';

export { TelegramChannel } from './TelegramChannel';

export type {
  TelegramChannelConfig,
} from './TelegramChannel';

export { WebChannel } from './WebChannel';

export type {
  WebChannelConfig,
} from './WebChannel';

export { setupGatewayFromConfig } from './GatewaySetup';

export type {
  GatewaySetupResult,
} from './GatewaySetup';
