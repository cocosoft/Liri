/**
 * 登出命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

export default {
  /**
   * 执行登出命令
   * @param args 参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    context.onDone?.('已登出', { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: '已成功登出。\n\n下次使用时请重新登录。',
      data: { loggedOut: true },
    };
  },
};
