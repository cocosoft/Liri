/**
 * Microsoft Teams 通道运行时入口
 * 对标 OpenClaw extensions/msteams/src/channel.runtime.ts
 *
 * 在运行时边界聚合通道运行时功能，保持主入口加载轻量。
 */
export { MSTeamsMonitor } from './monitor.js';
export { diagnoseMSTeams } from './doctor.js';
export { msteamsProbe } from './probe.js';
export { isMSTeamsSenderAuthorized } from './approval-auth.js';
export { TeamsHttpStream } from './streaming-message.js';
