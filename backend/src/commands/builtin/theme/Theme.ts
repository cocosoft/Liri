/**
 * 主题命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

export default {
  /**
   * 执行主题命令
   * @param args 子命令参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(' ');
    const subcommand = parts[0] || 'list';

    switch (subcommand.toLowerCase()) {
      case 'list':
        return this.handleList(context);
      case 'set':
        return this.handleSet(parts[1], context);
      case 'current':
        return this.handleCurrent(context);
      case 'reset':
        return this.handleReset(context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 列出主题
   */
  async handleList(context: CommandContext): Promise<CommandResult> {
    const themes = [
      {
        id: 'light',
        name: '浅色',
        description: '明亮清爽的外观',
        active: false,
      },
      { id: 'dark', name: '深色', description: '护眼暗色主题', active: true },
      {
        id: 'system',
        name: '跟随系统',
        description: '根据系统设置自动切换',
        active: false,
      },
      {
        id: 'high-contrast',
        name: '高对比度',
        description: '增强可读性',
        active: false,
      },
      {
        id: 'sepia',
        name: '护眼黄',
        description: '温暖的阅读体验',
        active: false,
      },
    ];

    const table = themes
      .map(
        (t) => `${t.id.padEnd(15)} ${t.name.padEnd(6)} ${t.active ? '✓' : ' '}`
      )
      .join('\n');

    return {
      success: true,
      type: 'text',
      message: `可用主题:\n\n${table}`,
      data: themes,
    };
  },

  /**
   * 设置主题
   */
  async handleSet(
    themeId: string,
    context: CommandContext
  ): Promise<CommandResult> {
    if (!themeId) {
      return {
        success: false,
        type: 'error',
        error: '请指定主题ID',
        message: '用法: /theme set <主题ID>',
      };
    }

    const themes: Record<string, string> = {
      light: '浅色',
      dark: '深色',
      system: '跟随系统',
      'high-contrast': '高对比度',
      sepia: '护眼黄',
    };

    const themeName = themes[themeId] || themeId;

    context.onDone?.(`主题已切换为: ${themeName}`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `主题已切换为: ${themeName}`,
      data: { themeId, themeName },
    };
  },

  /**
   * 显示当前主题
   */
  async handleCurrent(context: CommandContext): Promise<CommandResult> {
    const currentTheme = {
      id: 'dark',
      name: '深色',
      description: '护眼暗色主题',
      accentColor: '#6366f1',
    };

    return {
      success: true,
      type: 'text',
      message:
        `当前主题: ${currentTheme.name}\n\n` +
        `ID: ${currentTheme.id}\n` +
        `描述: ${currentTheme.description}\n` +
        `强调色: ${currentTheme.accentColor}`,
      data: currentTheme,
    };
  },

  /**
   * 重置主题
   */
  async handleReset(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('主题已重置为默认', { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: '主题已重置为默认设置',
      data: { reset: true },
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `主题命令用法:

/theme list     - 列出可用主题
/theme set <ID> - 设置主题
/theme current  - 显示当前主题
/theme reset    - 重置主题
/theme help     - 显示此帮助信息

可用主题:
  light         - 浅色
  dark          - 深色
  system        - 跟随系统
  high-contrast - 高对比度
  sepia         - 护眼黄

示例:
  /theme list
  /theme set dark`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
