/**
 * Memory命令模块入口
 */
import { Memory } from './Memory.js';
import type { Command } from '../../types/index.js';

/**
 * Memory命令定义
 */
const memoryCommand: Command = {
  type: 'local',
  name: 'memory',
  description: '内存管理和监控',
  aliases: ['mem', 'ram'],
  argumentHint: '[--processes|-p] [--trends|-t] [--events|-e] [--leaks|-l] [--optimize|-o]',
  whenToUse: '查看内存使用情况、监控内存泄漏和优化内存时使用',
  version: '1.0.0',
  userInvocable: true,
  loadedFrom: 'builtin',
  
  /**
   * 加载命令实现
   */
  async load(): Promise<any> {
    return new Memory();
  }
};

/**
 * 导出Memory命令实现
 */
export { Memory };

/**
 * 默认导出Memory命令定义
 */
export default memoryCommand;