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

/**
 * 通道模块出口（**能力面**，不含通道实现）。
 *
 * ## 为什么这里不再 `export` 26 个通道实现（2026-10-20，P1-pre 拆桶）
 *
 * 此前本桶逐条 `export { … } from './<channel>/index.js'`，导致**任何**引用本桶的模块
 * 都会把全部通道实现（及其 SDK 依赖）静态拉进产物 —— 实测 `@larksuiteoapi/node-sdk`
 * 6.39 MB、`channels/*` 44 个子目录全量进入 bundle，使 `ChannelCatalog` 的编译期裁剪
 * （`bun build --feature=DROP_CHANNEL_*`）**完全失效**（keep/drop 产物 metafile 完全相同）。
 *
 * 该约束此前只写在 `ChannelCatalog.ts` 的注释里（"本文件不得加入桶"），但**桶本身**仍在
 * 主链上 ⇒ 由桶把通道实现重新拉回。现按"先摘入口"的顺序拆除再导出：
 * 需要通道实例的调用方一律走 `CHANNEL_CATALOG[].load()`（位置无关惰性加载器）。
 *
 * 仓内取证：11 个引用方全部只用 `channelRegistry` / `channelBootstrapper` /
 * `getPairingStore` / `getDeliveryRouter` / 类型 / URL 常量，**无一处**使用通道实现类。
 *
 * ⚠️ 若确需在同步上下文拿到某个通道的工厂，请改用具体子入口
 * （`@modules/channels/<name>/index`）并在 `lint-architecture` 的 `canonicalEntryKeys` 登记，
 * **不要**把实现再导回本桶。
 */

// B5-2-100+（2026-10-18）：通道厂商站点 / 默认 API 基址单一事实源
export {
  WECOM_VENDOR_SITE_URL,
  YUANBAO_API_BASE_URL,
  YUANBAO_VENDOR_SITE_URL,
  MATRIX_SITE_URL,
  DINGTALK_SITE_URL,
  DISCORD_SITE_URL,
  FEISHU_SITE_URL,
  NOSTR_SITE_URL,
  QQ_SITE_URL,
  SIGNAL_SITE_URL,
} from './constants.js';
export { StickerCache } from './cache/index.js';
// 2026-10-19：配对存储经模块出口暴露（CLI `Liri pairing` 消费；守 R03-002）
export { PairingStore, getPairingStore } from './policy/PairingStore.js';

// PlatformAdapter — 轻量平台适配器体系
// 2026-10-20（P2）：`SlackAdapter` 已从桶里摘除（静态 import `channels/slack` 会穿透
// `DROP_CHANNELS_ALL`，把 Slack 通道整体拉进 core 产物；且全仓零消费者）。
export {
  BasePlatformAdapter,
  PlatformAdapterBridge,
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

// 2026-08-29 R03-002 收敛：base / accounts 统一出口
export { BaseChannelPlugin } from './base';
export type { ChannelPluginState } from './base';
export { MultiAccountManager } from './accounts';
export type {
  NamedAccount,
  ResolvedAccount,
  AccountRegistrationOptions,
} from './accounts';

export * from './monitoring/index.js';
