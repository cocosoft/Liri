/**
 * channels/ChannelManager.ts — 通道管理器
 *
 * 过渡期 re-export，实际代码位于 core/gateway/ChannelManager.ts
 */

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