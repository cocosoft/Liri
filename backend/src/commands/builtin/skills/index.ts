/**
 * Skills命令模块入口
 */
import { Skills } from './Skills.js';
import type { Command } from '../../types/index.js';

/**
 * Skills命令定义
 */
const skillsCommand: Command = {
  type: 'local',
  name: 'skills',
  description: '技能管理和展示',
  aliases: ['abilities', 'capabilities'],
  argumentHint: '[--stats|-s] [--categories|-c] [--usage|-u] [--trends|-t] [--search=关键词]',
  whenToUse: '查看可用技能、分析技能使用情况和搜索技能时使用',
  version: '1.0.0',
  userInvocable: true,
  loadedFrom: 'builtin',
  
  /**
   * 加载命令实现
   */
  async load(): Promise<any> {
    return new Skills();
  }
};

/**
 * 导出Skills命令实现
 */
export { Skills };

/**
 * 默认导出Skills命令定义
 */
export default skillsCommand;