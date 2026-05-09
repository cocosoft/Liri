/**
 * Doctor命令模块入口
 */
import type { Command } from '@modules/commands/types';

/**
 * Doctor命令定义
 */
const doctorCommand: Command = {
  type: 'local',
  name: 'doctor',
  description: '系统健康检查和问题诊断',
  aliases: ['diagnose', 'health-check'],
  argumentHint:
    '[--quick|-q] [--detailed|-d] [--fix|-f] [status] [--json] [help]',

  /**
   * 懒加载命令实现
   */
  load: () => import('./Doctor.js').then((m) => m.default),
};

export { doctorCommand };
