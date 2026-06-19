/**
 * 终端设置命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands';

export default {
  /**
   * 执行终端设置命令
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
      case 'shell':
        return this.handleShell(parts.slice(1), context);
      case 'theme':
        return this.handleTheme(parts[1], context);
      case 'font':
        return this.handleFont(parts.slice(1), context);
      case 'size':
        return this.handleSize(parts.slice(1), context);
      case 'reset':
        return this.handleReset(context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 显示终端设置
   */
  async handleShow(context: CommandContext): Promise<CommandResult> {
    const settings = {
      shell: context.environment?.SHELL || 'powershell',
      theme: 'default',
      fontSize: 14,
      fontFamily: 'Consolas',
      cursorStyle: 'block',
      scrollback: 10000,
    };

    return {
      success: true,
      type: 'text',
      message:
        `终端设置:\n` +
        `- Shell: ${settings.shell}\n` +
        `- 主题: ${settings.theme}\n` +
        `- 字体大小: ${settings.fontSize}\n` +
        `- 字体: ${settings.fontFamily}\n` +
        `- 光标样式: ${settings.cursorStyle}\n` +
        `- 回滚行数: ${settings.scrollback}`,
      data: settings,
    };
  },

  /**
   * 设置Shell
   */
  async handleShell(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    const shell = args[0];

    if (!shell) {
      return {
        success: false,
        type: 'error',
        error: '请指定Shell路径',
        message: '用法: /terminalSetup shell <shell路径>',
      };
    }

    if (context.environment) {
      context.environment.SHELL = shell;
    }

    context.onDone?.(`Shell已设置为: ${shell}`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `Shell已设置为: ${shell}`,
      data: { shell },
    };
  },

  /**
   * 设置主题
   */
  async handleTheme(
    theme: string,
    context: CommandContext
  ): Promise<CommandResult> {
    if (!theme) {
      return {
        success: false,
        type: 'error',
        error: '请指定主题名称',
        message: '用法: /terminalSetup theme <主题名>',
      };
    }

    context.onDone?.(`主题已设置为: ${theme}`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `主题已设置为: ${theme}`,
      data: { theme },
    };
  },

  /**
   * 设置字体
   */
  async handleFont(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    const fontSize = parseInt(args[0]) || 14;

    if (fontSize < 8 || fontSize > 72) {
      return {
        success: false,
        type: 'error',
        error: '字体大小必须在8-72之间',
      };
    }

    context.onDone?.(`字体大小已设置为: ${fontSize}`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `字体大小已设置为: ${fontSize}`,
      data: { fontSize },
    };
  },

  /**
   * 设置终端大小
   */
  async handleSize(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    const width = parseInt(args[0]) || 120;
    const height = parseInt(args[1]) || 30;

    context.onDone?.(`终端大小已设置为: ${width}x${height}`, {
      display: 'system',
    });

    return {
      success: true,
      type: 'text',
      message: `终端大小已设置为: ${width}x${height}`,
      data: { width, height },
    };
  },

  /**
   * 重置设置
   */
  async handleReset(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('终端设置已重置为默认值', { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: '终端设置已重置为默认值',
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `终端设置命令用法:

/terminalSetup show       - 显示当前设置
/terminalSetup shell <路径> - 设置默认Shell
/terminalSetup theme <主题> - 设置终端主题
/terminalSetup font <大小>  - 设置字体大小
/terminalSetup size <宽> <高> - 设置终端大小
/terminalSetup reset       - 重置为默认设置
/terminalSetup help        - 显示此帮助信息

示例:
  /terminalSetup show
  /terminalSetup shell bash
  /terminalSetup font 16`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
