/**
 * Doctor命令模块入口
 */
import { Doctor } from './Doctor.js';
import type { Command } from '../../types/index.js';

/**
 * Doctor命令定义
 */
const doctorCommand: Command = {
  type: 'local',
  name: 'doctor',
  description: '系统健康检查和问题诊断',
  aliases: ['diagnose', 'health-check'],
  argumentHint: '[--quick|-q] [--detailed|-d] [--fix|-f]',
  whenToUse: '检查系统健康状况和诊断问题时使用',
  version: '1.0.0',
  userInvocable: true,
  loadedFrom: 'builtin',
  
  /**
   * 加载命令实现
   */
  async load(): Promise<any> {
    return new Doctor();
  }
};

/**
 * 导出Doctor命令实现
 */
export { Doctor };

/**
 * 默认导出Doctor命令定义
 */
export { doctorCommand };