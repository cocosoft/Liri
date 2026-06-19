/**
 * 状态栏命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands';

export default {
  /**
   * 执行状态栏命令
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
   * 显示状态栏配置
   */
  async handleShow(context: CommandContext): Promise<CommandResult> {
    const config = {
      left: [
        { segment: 'mode', value: 'chat', display: 'Chat' },
        { segment: 'context', value: '45%', display: 'Context: 45%' },
      ],
      right: [
        { segment: 'time', value: '14:30', display: '14:30' },
        { segment: 'tokens', value: '2.5k', display: 'Tokens: 2.5k' },
        { segment: 'connection', value: 'online', display: '● Online' },
      ],
    };

    const renderBar = () => {
      const left = config.left.map((s) => s.display).join(' | ');
      const right = config.right.map((s) => s.display).join(' | ');
      const width = 60;
      const padding = width - left.length - right.length;
      return left + ' '.repeat(Math.max(1, padding)) + right;
    };

    return {
      success: true,
      type: 'text',
      message:
        `状态栏配置:\n\n[${renderBar()}]\n\n` +
        `左侧项目: ${config.left.map((s) => s.segment).join(', ')}\n` +
        `右侧项目: ${config.right.map((s) => s.segment).join(', ')}`,
      data: config,
    };
  },

  /**
   * 设置状态栏项目
   */
  async handleSet(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    const position = args[0];
    const segment = args[1];

    if (!position || !segment) {
      return {
        success: false,
        type: 'error',
        error: '参数不足',
        message: '用法: /statusline set <left|right> <segment>',
      };
    }

    context.onDone?.(`状态栏已更新`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `状态栏${position}侧已添加: ${segment}`,
      data: { position, segment },
    };
  },

  /**
   * 重置状态栏
   */
  async handleReset(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('状态栏已重置为默认配置', { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: '状态栏已重置为默认配置',
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `状态栏命令用法:

/statusline show    - 显示当前状态栏
/statusline set <位置> <项目> - 设置状态栏项目
/statusline reset   - 重置为默认配置
/statusline help    - 显示此帮助信息

位置: left, right
可用项目: mode, context, time, tokens, connection, session, cwd

示例:
  /statusline show
  /statusline set left mode`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
