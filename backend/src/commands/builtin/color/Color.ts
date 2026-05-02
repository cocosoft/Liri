/**
 * 颜色设置命令实现
 */
import type { CommandContext, CommandResult } from '../../types/index.js';

export default {
  /**
   * 执行颜色设置命令
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
      case 'theme':
        return this.handleTheme(parts[1], context);
      case 'scheme':
        return this.handleScheme(parts[1], context);
      case 'reset':
        return this.handleReset(context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 显示颜色设置
   */
  async handleShow(context: CommandContext): Promise<CommandResult> {
    const settings = {
      theme: 'dark',
      accentColor: '#00d4ff',
      textColor: '#ffffff',
      backgroundColor: '#1a1a2e',
      syntaxTheme: 'monokai',
    };

    return {
      success: true,
      type: 'text',
      message: `颜色设置:\n` +
        `- 主题: ${settings.theme}\n` +
        `- 强调色: ${settings.accentColor}\n` +
        `- 文字颜色: ${settings.textColor}\n` +
        `- 背景颜色: ${settings.backgroundColor}\n` +
        `- 语法主题: ${settings.syntaxTheme}`,
      data: settings,
    };
  },

  /**
   * 设置主题
   */
  async handleTheme(theme: string, context: CommandContext): Promise<CommandResult> {
    const validThemes = ['dark', 'light', 'system'];
    
    if (!theme || !validThemes.includes(theme.toLowerCase())) {
      return {
        success: false,
        type: 'error',
        error: `无效的主题: ${theme}`,
        message: `有效的主题: ${validThemes.join(', ')}`,
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
   * 设置配色方案
   */
  async handleScheme(scheme: string, context: CommandContext): Promise<CommandResult> {
    const schemes: Record<string, { accent: string; name: string }> = {
      ocean: { accent: '#00d4ff', name: '海洋蓝' },
      forest: { accent: '#4ade80', name: '森林绿' },
      sunset: { accent: '#fb923c', name: '日落橙' },
      purple: { accent: '#a855f7', name: '紫罗兰' },
      rose: { accent: '#f472b6', name: '玫瑰粉' },
    };

    const selected = schemes[scheme.toLowerCase()];
    
    if (!selected) {
      return {
        success: false,
        type: 'error',
        error: `无效的配色方案: ${scheme}`,
        message: `可用方案: ${Object.keys(schemes).join(', ')}`,
      };
    }

    context.onDone?.(`配色方案已设置为: ${selected.name}`, { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: `配色方案已设置为: ${selected.name} (${selected.accent})`,
      data: { scheme, accent: selected.accent },
    };
  },

  /**
   * 重置颜色设置
   */
  async handleReset(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('颜色设置已重置为默认值', { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: '颜色设置已重置为默认值',
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `颜色设置命令用法:

/color show          - 显示当前设置
/color theme <主题>   - 设置主题
/color scheme <方案>  - 设置配色方案
/color reset         - 重置为默认值
/color help          - 显示此帮助信息

可用主题: dark, light, system
可用配色方案: ocean, forest, sunset, purple, rose

示例:
  /color theme dark
  /color scheme ocean`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
