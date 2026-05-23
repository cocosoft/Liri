export {
  IrcChannel,
  ircChannel,
  createIrcChannel,
  ircChannelPlugin,
} from './irc/index.js';
export {
  SlackChannel,
  slackChannel,
  createSlackChannel,
  slackChannelPlugin,
} from './slack/index.js';
export {
  LineChannel,
  lineChannel,
  createLineChannel,
  lineChannelPlugin,
} from './line/index.js';
export {
  NostrChannel,
  nostrChannel,
  createNostrChannel,
  nostrChannelPlugin,
} from './nostr/index.js';
export {
  SmsChannel,
  smsChannel,
  createSmsChannel,
  smsChannelPlugin,
} from './sms/index.js';
export {
  EmailChannel,
  emailChannel,
  createEmailChannel,
  emailChannelPlugin,
} from './email/index.js';
export {
  WebhookChannel,
  webhookChannel,
  createWebhookChannel,
  webhookChannelPlugin,
} from './webhook/index.js';
export { StickerCache } from './cache/index.js';
export {
  ZaloChannel,
  zaloChannel,
  createZaloChannel,
  zaloChannelPlugin,
} from './zalo/index.js';
export {
  YuanbaoChannel,
  yuanbaoChannel,
  createYuanbaoChannel,
  yuanbaoChannelPlugin,
} from './yuanbao/index.js';
export {
  GoogleChatChannel,
  googleChatChannel,
  createGoogleChatChannel,
  googleChatChannelPlugin,
} from './googlechat/index.js';
export {
  MSTeamsChannel,
  msteamsChannel,
  createMSTeamsChannel,
  msteamsChannelPlugin,
} from './msteams/index.js';
export {
  WhatsAppChannel,
  whatsAppChannel,
  createWhatsAppChannel,
  whatsAppChannelPlugin,
} from './whatsapp/index.js';
export {
  SignalChannel,
  signalChannel,
  createSignalChannel,
  signalChannelPlugin,
} from './signal/index.js';
export {
  MatrixChannel,
  matrixChannel,
  createMatrixChannel,
  matrixChannelPlugin,
} from './matrix/index.js';
export {
  FacebookMessengerChannel,
  facebookMessengerChannel,
  createFacebookMessengerChannel,
  facebookMessengerChannelPlugin,
} from './facebookmessenger/index.js';
export {
  TwitterChannel,
  twitterChannel,
  createTwitterChannel,
  twitterChannelPlugin,
} from './twitter/index.js';
export {
  ClaudeChannel,
  claudeChannel,
  createClaudeChannel,
  claudeChannelPlugin,
} from './claude/index.js';
export { wecomChannel } from './wecom/index.js';
export * from './platforms/index.js';
export {
  ChannelRegistry,
  channelRegistry,
  adaptPluginToInterface,
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

export { ChannelBootstrapper, channelBootstrapper } from './bootstrap/index.js';
export type {
  ChannelBootstrapEntry,
  ChannelBootstrapConfig,
  ChannelBootstrapResult,
} from './bootstrap/index.js';
export { setupChannelsFromConfig } from './setupChannels.js';

export * from './monitoring/index.js';
