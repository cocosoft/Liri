/**
 * Discord 通道运行时入口
 * 对标 OpenClaw extensions/discord/src/channel.runtime.ts
 *
 * 在运行时边界聚合通道运行时功能，保持主入口加载轻量。
 */
export { DiscordMonitor } from './monitor';
export { diagnoseDiscord } from './doctor';
export { discordProbe } from './probe';
export { isDiscordSenderAuthorized } from './approval-auth';
export { DiscordStreamMessage } from './streaming-message';
