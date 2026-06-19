/**
 * 登录命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands';

export default {
  /**
   * 执行登录命令
   * @param args 参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const provider = args.trim() || 'default';

    context.onDone?.('正在登录...', { display: 'system' });

    return {
      success: true,
      type: 'text',
      message:
        `正在通过 ${provider} 登录...\n\n` + '请在浏览器中完成登录流程。',
      data: { provider, loggingIn: true },
    };
  },
};
