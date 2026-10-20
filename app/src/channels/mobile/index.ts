/**
 * 移动端（接入）通道 — 模块出口
 *
 * ⚠️ 仅导出**本通道**的内容；不要在此再导出其它通道（会破坏
 * `DROP_CHANNELS_ALL` 的编译期裁剪，见 `ChannelCatalog` 头注）。
 */

export {
  MobileChannel,
  createMobileChannel,
  mobileChannelPlugin,
  buildMobileMessageContext,
  parseMobileInboundBody,
  setMobileOutboundSink,
  getMobileOutboundSink,
} from './MobileChannel.js';
export type {
  MobileOutboundPayload,
  MobileOutboundSink,
  MobileInboundInput,
  MobileInboundParse,
} from './MobileChannel.js';
export {
  getDefaultMobileConfig,
  type MobileChannelConfig,
} from './config-schema.js';
export {
  mobileDeviceTokenStore,
  MOBILE_DEVICE_TOKEN_TTL_MS,
  MobileDeviceTokenStore,
  startMobilePairing,
  completeMobilePairing,
  listPairedMobileDevices,
  unpairMobileDevice,
  authorizeMobileRequest,
  resetMobilePairingForTest,
} from './MobilePairingService.js';
export type {
  MobileDeviceToken,
  CompleteMobilePairingResult,
  MobileAuthResult,
} from './MobilePairingService.js';
