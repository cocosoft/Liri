/**
 * 清空命令
 * 清空终端
 */
import type { Command } from '../../types/index.js';

/**
 * 清空命令
 */
export const clearCommand: Command = {
  type: 'action',
  name: 'clear',
  description: '清空终端',
  aliases: ['cls'],
  whenToUse: '当你需要清空终端屏幕时',
  load: async () => ({
    execute: async () => {
      // 清空终端
      process.stdout.write('\x1B[2J\x1B[0f');

      return {
        success: true,
        message: 'Terminal cleared',
      };
    },
  }),
};

export default clearCommand;
