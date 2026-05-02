/**
 * Usage命令模块入口
 */
import { Usage } from './Usage.js';
import type { Command } from '../../types/index.js';

/**
 * Usage命令定义
 */
const usageCommand: Command = {
  type: 'local',
  name: 'usage',
  description: '显示详细的使用统计和趋势分析',
  aliases: ['statistics', 'usage-stats'],
  argumentHint: '[--trends|-t] [--commands|-c] [--tools|-o] [--behavior|-b] [--performance|-p]',
  whenToUse: '查看详细使用统计和趋势分析时使用',
  version: '1.0.0',
  userInvocable: true,
  loadedFrom: 'builtin',
  
  /**
   * 加载命令实现
   */
  async load(): Promise<any> {
    return new Usage();
  }
};

/**
 * 导出Usage命令实现
 */
export { Usage };

/**
 * 默认导出Usage命令定义
 */
export default usageCommand;