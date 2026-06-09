/**
 * 飞书消息去重模块（已迁移至共享模块）
 *
 * @deprecated 请使用 @modules/channels/dedup 的共享去重模块。
 *   所有通道（包括飞书）应统一使用 channels/dedup/index.ts 提供的
 *   claimMessage / finalizeMessage 等函数。
 *
 * 对标 OpenClaw extensions/feishu/src/dedup.ts
 * 使用内存 Set + TTL 机制防止 WebSocket/Webhook 重传导致的重复消息处理
 * TTL 默认 24 小时，重启后重置
 */

export {
  configureDedup,
  tryBeginProcessing,
  releaseProcessing,
  isMessageProcessed,
  markMessageProcessed,
  claimMessage,
  finalizeMessage,
  getDedupStats,
} from '../dedup/index.js';
