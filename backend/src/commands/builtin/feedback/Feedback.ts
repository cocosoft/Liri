/**
 * 反馈命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

export default {
  /**
   * 执行反馈命令
   * @param args 子命令参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(' ');
    const subcommand = parts[0] || 'send';

    switch (subcommand.toLowerCase()) {
      case 'send':
        return this.handleSend(parts.slice(1), context);
      case 'type':
        return this.handleType(parts[1], context);
      case 'list':
        return this.handleList(context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 发送反馈
   */
  async handleSend(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    const message = args.join(' ');

    if (!message) {
      return {
        success: false,
        type: 'error',
        error: '请提供反馈内容',
        message: '用法: /feedback send <反馈内容>',
      };
    }

    context.onDone?.('感谢您的反馈！', { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `反馈已提交:\n\n"${message}"\n\n感谢您的反馈，我们会尽快处理。`,
      data: { message, submittedAt: new Date().toISOString() },
    };
  },

  /**
   * 设置反馈类型
   */
  async handleType(
    type: string,
    context: CommandContext
  ): Promise<CommandResult> {
    const validTypes = ['bug', 'feature', 'general'];

    if (!type || !validTypes.includes(type.toLowerCase())) {
      return {
        success: false,
        type: 'error',
        error: `无效的反馈类型: ${type}`,
        message: `有效的类型: ${validTypes.join(', ')}`,
      };
    }

    context.onDone?.(`反馈类型已设置为: ${type}`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `反馈类型已设置为: ${type}`,
      data: { type },
    };
  },

  /**
   * 列出反馈历史
   */
  async handleList(context: CommandContext): Promise<CommandResult> {
    const feedbackList = [
      {
        id: 'FB-001',
        type: 'bug',
        message: '登录问题',
        status: 'resolved',
        date: '2024-01-10',
      },
      {
        id: 'FB-002',
        type: 'feature',
        message: '深色模式',
        status: 'in_progress',
        date: '2024-01-12',
      },
      {
        id: 'FB-003',
        type: 'general',
        message: '建议优化性能',
        status: 'pending',
        date: '2024-01-15',
      },
    ];

    const table = feedbackList
      .map(
        (f) =>
          `[${f.id}] ${f.type.padEnd(8)} ${f.status.padEnd(12)} ${f.message}`
      )
      .join('\n');

    return {
      success: true,
      type: 'text',
      message: `反馈历史:\n\n${table}`,
      data: feedbackList,
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `反馈命令用法:

/feedback send <内容> - 发送反馈
/feedback type <类型>  - 设置反馈类型
/feedback list         - 列出反馈历史
/feedback help         - 显示此帮助信息

反馈类型:
  bug      - 问题报告
  feature  - 功能建议
  general  - 一般反馈

示例:
  /feedback send 建议增加深色模式
  /feedback type bug`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
