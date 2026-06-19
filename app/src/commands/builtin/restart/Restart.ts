/**
 * 重启命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands';

export default {
  /**
   * 执行重启命令
   * @param args 参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    context.onDone?.('正在重启...', { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: '正在重启应用...\n\n应用将在几秒后重新启动。',
      data: { restarting: true },
    };
  },
};
