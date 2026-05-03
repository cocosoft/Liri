// @ts-nocheck
/**
 * env 命令
 * 显示环境变量
 */
import type { Command, CommandContext, CommandResult } from '../../types/index.js';

export const envCommand: Command = {
  type: 'action',
  name: 'env',
  description: '显示环境变量',
  aliases: ['environment'],
  examples: [
    { description: '显示所有环境变量', command: '/env' },
    { description: '过滤显示', command: '/env | grep <pattern>' },
  ],

  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    try {
      const env = context.environment || process.env as Record<string, string>;
      const lines = ['# 环境变量', ''];

      if (args.length > 0 && args[0].includes('=')) {
        const filtered = Object.entries(env).filter(([key]) =>
          key.toLowerCase().includes(args[0].toLowerCase())
        );
        for (const [key, value] of filtered) {
          lines.push(`${key}=${value}`);
        }
      } else {
        for (const [key, value] of Object.entries(env)) {
          lines.push(`${key}=${value}`);
        }
      }

      return { success: true, message: lines.join('\n') };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export default envCommand;