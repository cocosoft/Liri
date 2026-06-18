/**
 * ChannelManager 工厂函数
 * 从 ChannelManager.ts 抽取，遵循单类原则。
 */
import { ChannelManager } from './ChannelManager';
import type { ChannelManagerConfig } from './ChannelManagerTypes';

/** 全局 ChannelManager 单例 */
let _channelManagerInstance: ChannelManager | null = null;

/**
 * 创建 ChannelManager 实例
 */
export function createChannelManager(
  config?: ChannelManagerConfig
): ChannelManager {
  return new ChannelManager(config);
}

/**
 * 获取全局 ChannelManager 单例
 * 首次调用时自动创建
 */
export function getChannelManager(
  config?: ChannelManagerConfig
): ChannelManager {
  if (!_channelManagerInstance) {
    _channelManagerInstance = createChannelManager(config);
  }
  return _channelManagerInstance;
}

/**
 * 断开所有通道连接（用于优雅关闭）
 * 安全可重入
 */
export async function disconnectAllChannels(): Promise<void> {
  if (!_channelManagerInstance) {
    return;
  }
  await _channelManagerInstance.stop();
}
