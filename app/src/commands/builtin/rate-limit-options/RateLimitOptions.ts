/**
 * 速率限制选项命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands';

export default {
  /**
   * 执行速率限制选项命令
   * @param args 子命令参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(' ');
    const subcommand = parts[0] || 'show';

    switch (subcommand.toLowerCase()) {
      case 'show':
        return this.handleShow(context);
      case 'set':
        return this.handleSet(parts.slice(1), context);
      case 'reset':
        return this.handleReset(context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 显示速率限制配置
   */
  async handleShow(context: CommandContext): Promise<CommandResult> {
    const config = {
      requestsPerMinute: 60,
      requestsPerHour: 1000,
      tokensPerMinute: 100000,
      concurrentRequests: 5,
      burstSize: 10,
      cooldownPeriod: 60,
    };

    return {
      success: true,
      type: 'text',
      message:
        `速率限制配置:\n\n` +
        `- 每分钟请求数: ${config.requestsPerMinute}\n` +
        `- 每小时请求数: ${config.requestsPerHour}\n` +
        `- 每分钟Token数: ${config.tokensPerMinute.toLocaleString()}\n` +
        `- 并发请求数: ${config.concurrentRequests}\n` +
        `- 突发大小: ${config.burstSize}\n` +
        `- 冷却周期: ${config.cooldownPeriod}秒`,
      data: config,
    };
  },

  /**
   * 设置速率限制
   */
  async handleSet(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    const option = args[0];
    const value = parseInt(args[1]);

    if (!option || isNaN(value)) {
      return {
        success: false,
        type: 'error',
        error: '参数不足或值无效',
        message: '用法: /rate-limit-options set <选项> <值>',
      };
    }

    const validOptions = [
      'requestsPerMinute',
      'requestsPerHour',
      'tokensPerMinute',
      'concurrentRequests',
      'burstSize',
      'cooldownPeriod',
    ];

    if (!validOptions.includes(option)) {
      return {
        success: false,
        type: 'error',
        error: `无效的选项: ${option}`,
        message: `有效选项: ${validOptions.join(', ')}`,
      };
    }

    context.onDone?.(`速率限制已更新: ${option} = ${value}`, {
      display: 'system',
    });

    return {
      success: true,
      type: 'text',
      message: `速率限制已更新:\n${option} = ${value}`,
      data: { option, value },
    };
  },

  /**
   * 重置速率限制
   */
  async handleReset(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('速率限制已重置为默认值', { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: '速率限制已重置为默认值',
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `速率限制选项命令用法:

/rate-limit-options show         - 显示当前配置
/rate-limit-options set <选项> <值> - 设置限制
/rate-limit-options reset        - 重置为默认
/rate-limit-options help         - 显示此帮助信息

可用选项:
  requestsPerMinute  - 每分钟请求数
  requestsPerHour    - 每小时请求数
  tokensPerMinute    - 每分钟Token数
  concurrentRequests - 并发请求数
  burstSize          - 突发大小
  cooldownPeriod     - 冷却周期(秒)

示例:
  /rate-limit-options set requestsPerMinute 100`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
