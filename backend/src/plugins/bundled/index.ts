/**
 * 内置插件模块（基于CC源码）
 * 提供默认内置插件的注册和加载
 */

export * from './WelcomePlugin.js';
export * from './HelpPlugin.js';
export * from './SettingsPlugin.js';
export * from './StatusPlugin.js';

/**
 * 内置插件列表
 */
export const bundledPlugins = [
  'welcome',
  'help',
  'settings',
  'status',
];

/**
 * 获取所有内置插件名称
 */
export function getBundledPluginNames(): string[] {
  return [...bundledPlugins];
}