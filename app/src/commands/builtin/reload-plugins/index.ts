/**
 * 插件重载命令
 * 重新加载插件
 */
import type { Command } from '@modules/commands/types';

/**
 * reload-plugins 命令定义
 */
export const reloadPluginsCommand: Command = {
  type: 'action',
  name: 'reload-plugins',
  description: '重载插件',
  aliases: ['reload'],
  argumentHint: '[插件名]',
  whenToUse: '当你需要重新加载插件时',
  load: async () =>
    import('./ReloadPlugins.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};

export default reloadPluginsCommand;
