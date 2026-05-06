/**
 * Plugins命令模块入口
 */
import { Plugins } from './Plugins.js';
import type { Command } from '@modules/commands/types';

/**
 * Plugins命令定义
 */
const pluginsCommand: Command = {
  type: 'local',
  name: 'plugins',
  description: '插件管理和配置',
  aliases: ['plugin', 'extensions'],
  argumentHint: '[--list|-l] [--status|-s] [--manage|-m] [--dependencies|-d] [--test|-t] [--search=关键词]',
  whenToUse: '查看插件状态、管理插件依赖和测试插件时使用',
  version: '1.0.0',
  userInvocable: true,
  loadedFrom: 'builtin',
  
  /**
   * 加载命令实现
   */
  async load(): Promise<any> {
    return new Plugins();
  }
};

/**
 * 导出Plugins命令实现
 */
export { Plugins };

/**
 * 默认导出Plugins命令定义
 */
export { pluginsCommand };