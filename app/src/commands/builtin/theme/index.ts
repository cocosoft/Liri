/**
 * 主题命令
 * 管理界面主题，支持内置主题和用户自定义主题。
 */
import type { Command } from '@modules/commands/types';

/**
 * theme 命令定义
 */
export const themeCommand: Command = {
  type: 'action',
  name: 'theme',
  description: '主题设置 — 列出/切换/预览/导入主题',
  aliases: ['appearance', 'look'],
  argumentHint:
    '[list|set <name>|current|preview [name]|import <path>|reset|help]',
  whenToUse: '当你需要更改界面主题、预览配色或导入自定义主题时',
  load: async () =>
    import('./Theme.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};
