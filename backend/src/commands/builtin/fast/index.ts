/**
 * Fast命令模块入口
 */
import { Fast } from './Fast.js';
import type { Command } from '@modules/commands/types';

/**
 * Fast命令定义
 */
const fastCommand: Command = {
  type: 'local',
  name: 'fast',
  description: '快速操作和性能优化',
  aliases: ['optimize', 'speed-up'],
  argumentHint: '[--optimize|-o] [--cleanup|-c] [--boost|-b] [--analyze|-a]',
  whenToUse: '需要快速优化系统性能或清理系统时使用',
  version: '1.0.0',
  userInvocable: true,
  loadedFrom: 'builtin',
  
  /**
   * 加载命令实现
   */
  async load(): Promise<any> {
    return new Fast();
  }
};

/**
 * 导出Fast命令实现
 */
export { Fast };

/**
 * 默认导出Fast命令定义
 */
export { fastCommand };