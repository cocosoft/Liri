/**
 * 主题命令实现
 *
 * 集成 ThemeManager 和 ThemeLoader，提供完整的主题管理功能。
 * 子命令：list / set / current / preview / import / reset / help
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';
import { ThemeManager } from '@modules/ui/ThemeManager';

export default {
  /**
   * 执行主题命令
   * @param args 子命令参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0] || 'list';

    switch (subcommand.toLowerCase()) {
      case 'list':
        return this.handleList(context);
      case 'set':
        return this.handleSet(parts[1], context);
      case 'current':
        return this.handleCurrent(context);
      case 'preview':
        return this.handlePreview(parts[1]);
      case 'import':
        return this.handleImport(parts.slice(1).join(' '));
      case 'reset':
        return this.handleReset(context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 获取主题管理器实例
   */
  private getManager(): ThemeManager {
    return ThemeManager.getInstance();
  },

  /**
   * 列出可用主题
   */
  async handleList(context: CommandContext): Promise<CommandResult> {
    const manager = this.getManager();
    const themes = manager.getAllAvailableThemes();
    const current = manager.getThemeName();

    const currentMeta = manager.getThemeLoader().getAllThemeMetadata();
    const metaMap = new Map<string, string>();
    for (const m of currentMeta) {
      metaMap.set(m.name, m.displayName || m.name);
    }

    const lines = themes.map((name) => {
      const display = metaMap.get(name) || name;
      const marker = name === current ? ' ✓' : '  ';
      return `  ${name.padEnd(18)}${marker}  ${display}`;
    });

    return {
      success: true,
      type: 'text',
      message:
        `可用主题 (${themes.length} 个)\n` +
        `${'─'.repeat(48)}\n` +
        lines.join('\n') +
        `\n${'─'.repeat(48)}\n` +
        `当前主题: ${current}\n` +
        `用法: /theme set <主题名>  切换主题\n` +
        `      /theme preview <主题名>  预览主题`,
      data: { themes, current },
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
        error: '请指定主题名称',
        message: '用法: /theme set <主题名>\n可用主题通过 /theme list 查看',
      };
    }

    const manager = this.getManager();
    const success = manager.setTheme(themeId);

    if (!success) {
      const available = manager.getAllAvailableThemes().join(', ');
      return {
        success: false,
        type: 'error',
        error: `未知主题: ${themeId}`,
        message: `未知主题: ${themeId}\n可用主题: ${available}\n用法: /theme set <主题名>`,
      };
    }

    const themeName = manager.getThemeName();

    context.onDone?.(`主题已切换为: ${themeName}`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `主题已切换为: ${themeName}\n使用 /theme current 查看详情`,
      data: { themeId: themeName },
    };
  },

  /**
   * 显示当前主题
   */
  async handleCurrent(context: CommandContext): Promise<CommandResult> {
    const manager = this.getManager();
    const theme = manager.getTheme();
    const colors = theme.colors;

    const lines = [
      `当前主题: ${theme.name}`,
      `字体: ${manager.getConfig().fontFamily || 'monospace'}`,
      `字号: ${manager.getConfig().fontSize || 14}`,
      ``,
      `配色方案:`,
      `  ${'前景'.padEnd(10)} ${colors.foreground}`,
      `  ${'背景'.padEnd(10)} ${colors.background}`,
      `  ${'红色'.padEnd(10)} ${colors.red}`,
      `  ${'绿色'.padEnd(10)} ${colors.green}`,
      `  ${'黄色'.padEnd(10)} ${colors.yellow}`,
      `  ${'蓝色'.padEnd(10)} ${colors.blue}`,
      `  ${'品红'.padEnd(10)} ${colors.magenta}`,
      `  ${'青色'.padEnd(10)} ${colors.cyan}`,
      `  ${'白色'.padEnd(10)} ${colors.white}`,
      ``,
      `高亮:`,
      `  ${'亮红'.padEnd(10)} ${colors.brightRed}`,
      `  ${'亮绿'.padEnd(10)} ${colors.brightGreen}`,
      `  ${'亮蓝'.padEnd(10)} ${colors.brightBlue}`,
      `  ${'亮黄'.padEnd(10)} ${colors.brightYellow}`,
    ];

    return {
      success: true,
      type: 'text',
      message: lines.join('\n'),
      data: theme,
    };
  },

  /**
   * 预览主题配色
   */
  async handlePreview(themeId?: string): Promise<CommandResult> {
    const manager = this.getManager();
    let colors = manager.getTheme().colors;

    if (themeId) {
      const loaded = manager.getThemeLoader().getTheme(themeId);
      if (loaded) {
        colors = loaded.colors;
      } else {
        return {
          success: false,
          type: 'error',
          error: `未知主题: ${themeId}`,
          message: `未知主题: ${themeId}。使用 /theme list 查看可用主题。`,
        };
      }
    }

    const displayName = themeId || `${manager.getThemeName()} (当前)`;

    const swatch = (label: string, color: string): string => {
      return `  ${label.padEnd(14)} ${color}`;
    };

    const lines = [
      `主题预览: ${displayName}`,
      `${'─'.repeat(42)}`,
      swatch('前景 (foreground)', colors.foreground),
      swatch('背景 (background)', colors.background),
      swatch('光标 (cursor)', colors.cursor),
      swatch('选择背景 (selectionBg)', colors.selectionBackground),
      ``,
      `标准色:`,
      swatch('黑色', colors.black),
      swatch('红色', colors.red),
      swatch('绿色', colors.green),
      swatch('黄色', colors.yellow),
      swatch('蓝色', colors.blue),
      swatch('品红', colors.magenta),
      swatch('青色', colors.cyan),
      swatch('白色', colors.white),
      ``,
      `亮色:`,
      swatch('亮红', colors.brightRed),
      swatch('亮绿', colors.brightGreen),
      swatch('亮黄', colors.brightYellow),
      swatch('亮蓝', colors.brightBlue),
      swatch('亮品红', colors.brightMagenta),
      swatch('亮青', colors.brightCyan),
      swatch('亮白', colors.brightWhite),
      `${'─'.repeat(42)}`,
      `使用 /theme set ${themeId || '<主题名>'} 应用此主题`,
    ];

    return {
      success: true,
      type: 'text',
      message: lines.join('\n'),
      data: { themeId: themeId || manager.getThemeName(), colors },
    };
  },

  /**
   * 从文件导入自定义主题
   */
  async handleImport(filePath: string): Promise<CommandResult> {
    if (!filePath) {
      return {
        success: false,
        type: 'error',
        error: '请指定主题文件路径',
        message:
          '用法: /theme import <文件路径>\n' +
          '支持 .json 格式的主题配置文件。\n' +
          '示例: /theme import ~/my-theme.json',
      };
    }

    try {
      const { readFileSync, existsSync } = await import('fs');
      const { resolve } = await import('path');

      const absPath = filePath.startsWith('~')
        ? resolve(
            (await import('os')).homedir(),
            filePath.slice(filePath.startsWith('~/') ? 2 : 1)
          )
        : resolve(filePath);

      if (!existsSync(absPath)) {
        return {
          success: false,
          type: 'error',
          error: `文件不存在: ${absPath}`,
          message: `文件不存在: ${absPath}\n请检查路径是否正确。`,
        };
      }

      const manager = this.getManager();
      const loader = manager.getThemeLoader();

      const imported = loader.importThemeFromFile(absPath);
      if (!imported) {
        return {
          success: false,
          type: 'error',
          error: '主题导入失败',
          message:
            '主题导入失败。可能的原因：\n' +
            '1. JSON 格式不正确\n' +
            '2. 缺少必填字段\n' +
            '3. 主题名称与内置主题冲突\n' +
            '请确保文件符合主题 JSON Schema。',
        };
      }

      const saved = loader.saveUserTheme(imported);
      if (!saved) {
        return {
          success: false,
          type: 'error',
          error: '主题保存失败',
          message: '主题文件解析成功但保存到用户目录时失败。',
        };
      }

      return {
        success: true,
        type: 'text',
        message:
          `主题导入成功: ${imported.displayName || imported.name}\n` +
          `来自: ${absPath}\n` +
          `使用 /theme set ${imported.name} 应用此主题`,
        data: { name: imported.name, path: absPath },
      };
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: `导入异常: ${error instanceof Error ? error.message : String(error)}`,
        message: `主题导入失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * 重置主题
   */
  async handleReset(context: CommandContext): Promise<CommandResult> {
    this.getManager().resetToDefault();

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

/theme list              - 列出可用主题
/theme set <主题名>       - 设置主题
/theme current           - 显示当前主题详情
/theme preview [主题名]   - 预览主题配色（省略则预览当前）
/theme import <文件路径>  - 从 JSON 文件导入自定义主题
/theme reset             - 重置为默认主题
/theme help              - 显示此帮助信息

示例:
  /theme list
  /theme set dracula
  /theme preview nord
  /theme import ~/Downloads/my-theme.json`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
