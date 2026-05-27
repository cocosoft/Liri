/**
 * Google Chat 通道运行时入口
 * 对标 OpenClaw extensions/googlechat/src/channel.runtime.ts
 *
 * 在运行时边界聚合通道运行时功能，保持主入口加载轻量。
 */
export { GoogleChatMonitor } from './monitor.js';
export { diagnoseGoogleChat } from './doctor.js';
export { googleChatProbe } from './probe.js';
export { isGoogleChatSenderAuthorized } from './approval-auth.js';
