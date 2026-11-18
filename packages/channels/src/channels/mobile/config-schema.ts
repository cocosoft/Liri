/**
 * 移动端（接入）通道 — 配置 schema
 *
 * 三源契约（`tests/channels/ChannelContract.test.ts`）：本文件默认值字段
 * 必须 ⊆ `MobileChannelPlugin.config.getDefaultConfig()` 且值一致。
 *
 * 移动端**无平台凭据**（启用键是 `LIRI_MOBILE_CHANNEL`），故字段极少：
 * 传输复用 `LocalHTTPService` + `/v1/events`，不新起监听端口。
 */

export interface MobileChannelConfig {
  /** 通道启用位（与 `LIRI_MOBILE_CHANNEL` 启用判据配合） */
  enabled: boolean;
}

export function getDefaultMobileConfig(): MobileChannelConfig {
  return {
    enabled: true,
  };
}
