/**
 * 渠道插件系统导出
 */

export { ChannelPluginCatalog, channelPluginCatalog } from './ChannelPluginCatalog.js';
export type { ChannelPlugin, ChannelPluginType, ChannelPluginCatalogEntry } from './ChannelPluginCatalog.js';

export { ChannelPluginValidator, channelPluginValidator } from './ChannelPluginValidator.js';
export type { ValidationResult, ValidationRule } from './ChannelPluginValidator.js';

export { ChannelPluginPresence, channelPluginPresence } from './ChannelPluginPresence.js';
export type { PresenceResult, DependencyStatus } from './ChannelPluginPresence.js';
