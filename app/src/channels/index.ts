// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
export { createIrcChannel, ircChannelPlugin } from './irc/index.js';
export { createSlackChannel, slackChannelPlugin } from './slack/index.js';
export { createLineChannel, lineChannelPlugin } from './line/index.js';
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
  createGoogleChatChannel,
  googleChatChannelPlugin,
} from './googlechat/index.js';
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
export { createMatrixChannel, matrixChannelPlugin } from './matrix/index.js';
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
export {
  wecomChannel,
  createWecomChannel,
  wecomChannelPlugin,
} from './wecom/index.js';
export { qqChannel, createQQChannel, qqChannelPlugin } from './qq/index.js';
export {
  telegramChannel,
  createTelegramChannel,
  telegramChannelPlugin,
} from './telegram/index.js';
export {
  wechatChannel,
  createWechatChannel,
  wechatChannelPlugin,
} from './wechat/index.js';
export {
  discordChannel,
  createDiscordChannel,
  discordChannelPlugin,
} from './discord/index.js';
export {
  feishuChannel,
  createFeishuChannel,
  feishuChannelPlugin,
} from './feishu/index.js';
export {
  dingtalkChannel,
  createDingtalkChannel,
  dingtalkChannelPlugin,
} from './dingtalk/index.js';
export {
  mattermostChannel,
  createMattermostChannel,
  mattermostChannelPlugin,
} from './mattermost/index.js';
export {
  bluebubblesChannel,
  createBlueBubblesChannel,
  bluebubblesChannelPlugin,
} from './bluebubbles/index.js';
// PlatformAdapter — 轻量平台适配器体系
export {
  BasePlatformAdapter,
  PlatformAdapterBridge,
  SlackAdapter,
} from './platform/index.js';
export type {
  PlatformAdapter,
  PlatformMessageEvent,
  PlatformProcessingOutcome,
  PlatformMessageType,
} from './platform/index.js';

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
