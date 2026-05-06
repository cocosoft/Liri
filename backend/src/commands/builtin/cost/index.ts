/**
 * Cost命令模块入口
 */
import { CostCommand } from './Cost.js';
import type { Command } from '@modules/commands/types';

/**
 * Cost命令定义
 */
const costCommand: Command = {
  type: 'local',
  name: 'cost',
  description: '显示API调用成本和使用统计',
  aliases: ['costs', 'usage-cost'],
  argumentHint: '[--breakdown|-b] [--usage|-u] [--time|-t]',
  whenToUse: '查看API调用成本和使用统计时使用',
  version: '1.0.0',
  userInvocable: true,
  loadedFrom: 'builtin',
  
  /**
   * 加载命令实现
   */
  async load(): Promise<any> {
    return new CostCommand();
  }
};

/**
 * 导出Cost命令实现
 */
export { CostCommand };

/**
 * 默认导出Cost命令定义
 */
export { costCommand };