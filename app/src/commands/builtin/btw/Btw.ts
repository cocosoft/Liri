/**
 * btw命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

export default {
  /**
   * 执行btw命令
   * @param args 附加内容
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const message = args.trim();

    const responses = [
      '好的，记住了！',
      '收到！',
      '明白了！',
      '好的，还有什么需要我帮忙的吗？',
      '好的，我会记住的！',
    ];

    const response = responses[Math.floor(Math.random() * responses.length)];

    if (message) {
      context.onDone?.(`已记录: ${message}`, { display: 'system' });
    }

    return {
      success: true,
      type: 'text',
      message: message ? `${response}\n\n已记录: "${message}"` : response,
      data: { message },
    };
  },
};
