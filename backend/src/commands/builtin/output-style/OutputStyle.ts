/**
 * 输出风格命令实现
 */
import type { CommandContext, CommandResult } from '../../types/index.js';

export type OutputFormat = 'text' | 'json' | 'markdown' | 'compact';
export type ColorMode = 'auto' | 'light' | 'dark';

export default {
  /**
   * 执行输出风格命令
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
      case 'format':
        return this.handleFormat(parts[1], context);
      case 'color':
        return this.handleColor(parts[1], context);
      case 'reset':
        return this.handleReset(context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 显示当前输出设置
   */
  async handleShow(context: CommandContext): Promise<CommandResult> {
    const settings = {
      format: context.environment?.OUTPUT_FORMAT || 'text' as OutputFormat,
      colorMode: context.environment?.COLOR_MODE || 'auto' as ColorMode,
      wordWrap: true,
      lineNumbers: false,
      compactMode: false,
    };

    return {
      success: true,
      type: 'text',
      message: `输出设置:\n` +
        `- 格式: ${settings.format}\n` +
        `- 颜色模式: ${settings.colorMode}\n` +
        `- 自动换行: ${settings.wordWrap ? '开启' : '关闭'}\n` +
        `- 行号显示: ${settings.lineNumbers ? '开启' : '关闭'}\n` +
        `- 紧凑模式: ${settings.compactMode ? '开启' : '关闭'}`,
      data: settings,
    };
  },

  /**
   * 设置输出格式
   */
  async handleFormat(format: string, context: CommandContext): Promise<CommandResult> {
    const validFormats: OutputFormat[] = ['text', 'json', 'markdown', 'compact'];
    
    if (!format || !validFormats.includes(format as OutputFormat)) {
      return {
        success: false,
        type: 'error',
        error: `无效的输出格式: ${format}`,
        message: `有效的格式: ${validFormats.join(', ')}`,
      };
    }

    if (context.environment) {
      context.environment.OUTPUT_FORMAT = format;
    }

    context.onDone?.(`输出格式已设置为: ${format}`, { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: `输出格式已设置为: ${format}`,
      data: { format },
    };
  },

  /**
   * 设置颜色模式
   */
  async handleColor(mode: string, context: CommandContext): Promise<CommandResult> {
    const validModes: ColorMode[] = ['auto', 'light', 'dark'];
    
    if (!mode || !validModes.includes(mode as ColorMode)) {
      return {
        success: false,
        type: 'error',
        error: `无效的颜色模式: ${mode}`,
        message: `有效的模式: ${validModes.join(', ')}`,
      };
    }

    if (context.environment) {
      context.environment.COLOR_MODE = mode;
    }

    context.onDone?.(`颜色模式已设置为: ${mode}`, { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: `颜色模式已设置为: ${mode}`,
      data: { mode },
    };
  },

  /**
   * 重置输出设置
   */
  async handleReset(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('输出设置已重置为默认值', { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: '输出设置已重置为默认值',
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `输出风格命令用法:

/output-style show      - 显示当前输出设置
/output-style format <格式> - 设置输出格式
/output-style color <模式>  - 设置颜色模式
/output-style reset     - 重置为默认设置
/output-style help      - 显示此帮助信息

可用格式:
  text      - 纯文本格式
  json      - JSON格式
  markdown  - Markdown格式
  compact   - 紧凑格式

可用颜色模式:
  auto      - 自动检测
  light     - 浅色模式
  dark      - 深色模式

示例:
  /output-style format markdown
  /output-style color dark`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
