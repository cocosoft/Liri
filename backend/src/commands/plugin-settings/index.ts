/**
 * 插件设置命令
 * 提供插件配置管理功能
 */

import type { Command, CommandContext, CommandResult } from '@modules/commands/types';

/**
 * 插件设置命令
 */
const pluginSettings: Command = {
  type: 'local',
  name: 'plugin-settings',
  aliases: ['ps'],
  description: '管理插件设置',
  argumentHint: '[plugin-name] [get|set|list|reset] [key] [value]',
  load: async () => {
    const { executePluginSettings } = await import('./pluginSettings.js');
    return {
      execute: executePluginSettings,
    };
  },
};

export default pluginSettings;
