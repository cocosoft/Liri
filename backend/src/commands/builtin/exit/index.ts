/**
 * 退出命令
 * 退出系统
 */
import type { Command } from '../../types/index.js';

/**
 * 退出命令
 */
export const exitCommand: Command = {
  type: 'action',
  name: 'exit',
  description: '退出系统',
  aliases: ['quit', 'q'],
  whenToUse: '当你需要退出PY_APP时',
  load: async () => ({
    execute: async () => {
      console.log('Exiting PY_APP...');
      // 退出进程
      process.exit(0);

      // 这里的代码不会执行，因为进程已经退出
      return {
        success: true,
        message: 'Exiting...',
      };
    },
  }),
};

export default exitCommand;
