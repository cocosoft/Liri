/**
 * Slack App安装命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands';

export default {
  /**
   * 执行Slack App安装命令
   * @param args 参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    context.onDone?.('正在安装Slack App...', { display: 'system' });

    return {
      success: true,
      type: 'text',
      message:
        '正在安装Slack App...\n\n' + '请在浏览器中授权Slack App访问权限。',
      data: { installing: true },
    };
  },
};
