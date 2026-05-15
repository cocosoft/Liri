export { IrcChannel } from './irc/index.js';
export { SlackChannel } from './slack/index.js';
export { LineChannel } from './line/index.js';
export { NostrChannel } from './nostr/index.js';
export { SmsChannel } from './sms/index.js';
export { EmailChannel } from './email/index.js';
export { WebhookChannel } from './webhook/index.js';
export { StickerCache } from './cache/index.js';
export { ZaloChannel } from './zalo/ZaloChannel.js';
export { YuanbaoChannel } from './yuanbao/YuanbaoChannel.js';
export { GoogleChatChannel } from './googlechat/GoogleChatChannel.js';
export { MSTeamsChannel } from './msteams/MSTeamsChannel.js';
export * from './platforms/index.js';
export {
  ChannelRegistry,
  channelRegistry,
} from './registry/ChannelRegistry.js';
export type {
  ChannelInterface,
  ChannelConfig,
  ChannelMessage,
} from './registry/ChannelRegistry.js';

export { DeliveryTarget } from './DeliveryTarget';
export {
  DeliveryRouter,
  getDeliveryRouter,
  resetDeliveryRouter,
} from './DeliveryRouter';
export type {
  DeliveryMode,
  DeliveryTask,
  DeliveryResult,
  BatchDeliveryResult,
} from './DeliveryRouter';

export {
  ChannelSessionManager,
  channelSessionManager,
} from './session/ChannelSessionManager.js';
export type {
  ChannelSession,
  ChannelSessionStatus,
  ChannelSessionEvent,
} from './session/ChannelSessionManager.js';

export {
  ChannelLogManager,
  channelLogManager,
} from './log/ChannelLogManager.js';
export type {
  LogLevel,
  ChannelLogEntry,
  ChatType,
  ChatMeta,
} from './log/ChannelLogManager.js';

export { TurnManager, turnManager } from './turn/TurnManager.js';
export type {
  TurnStrategy,
  TurnEntry,
  TurnConfig,
  TurnEvent,
} from './turn/TurnManager.js';

export {
  MessageMirrorService,
  getMessageMirrorService,
  resetMessageMirrorService,
} from './MessageMirrorService';
export type {
  MirrorRule,
  MirrorRecord,
  MirrorConfig,
} from './MessageMirrorService';
export {
  DevicePairingService,
  getDevicePairingService,
} from './DevicePairingService';
export type {
  PairingConfig,
  PairedDevice,
  DeviceInfo,
  PairingRequest,
  PairingStatus,
} from './DevicePairingService';
export {
  RuntimeFooterFactory,
  getRuntimeFooterFactory,
} from './RuntimeFooterFactory';
export type { RuntimeFooterConfig, RuntimeInfo } from './RuntimeFooterFactory';
export {
  GatewaySessionTracer,
  getGatewaySessionTracer,
} from './GatewaySessionTracer';
export type {
  GatewayTraceRecord,
  GatewayTraceConfig,
} from './GatewaySessionTracer';
