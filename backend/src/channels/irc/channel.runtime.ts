/**
 * IRC 通道运行时入口
 * 对标 OpenClaw extensions/irc/src/channel.runtime.ts
 *
 * 在运行时边界聚合通道运行时功能，保持主入口加载轻量。
 */
export { IrcMonitor } from './monitor.js';
export { diagnoseIrc } from './doctor.js';
export { ircProbe } from './probe.js';
