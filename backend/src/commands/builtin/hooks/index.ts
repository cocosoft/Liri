/**
 * Hooks命令模块入口
 */
import { Hooks } from './Hooks.js';
import type { Command } from '../../types/index.js';

/**
 * Hooks命令定义
 */
const hooksCommand: Command = {
  type: 'local',
  name: 'hooks',
  description: '钩子管理和执行',
  aliases: ['hook', 'triggers'],
  argumentHint: '[--list|-l] [--stats|-s] [--execute=钩子名] [--test|-t] [--manage|-m]',
  whenToUse: '查看钩子状态、执行钩子测试和管理钩子时使用',
  version: '1.0.0',
  userInvocable: true,
  loadedFrom: 'builtin',
  
  /**
   * 加载命令实现
   */
  async load(): Promise<any> {
    return new Hooks();
  }
};

/**
 * 导出Hooks命令实现
 */
export { Hooks };

/**
 * 默认导出Hooks命令定义
 */
export default hooksCommand;