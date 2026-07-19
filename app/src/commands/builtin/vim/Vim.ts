/**
 * Vim命令
 * 切换编辑模式：normal ↔ vim
 * 对标 CC 源码 cc_code/backend/commands/vim/vim.ts
 *
 * CC 中的 /vim 命令是一个简单的模式切换开关，实际的 Vim 键盘处理
 * 由 cc_code/backend/vim/ 目录下的完整状态机实现（包括 transitions.ts、
 * operators.ts、motions.ts、textObjects.ts）以及 React 钩子
 * cc_code/backend/hooks/useVimInput.ts 驱动。
 */

import { configManager } from '@modules/config/ConfigManager.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'commands:builtin:vim:Vim',
  level: LogLevel.INFO,
});

/**
 * Vim命令实现
 */
const vimCommand = {
  async execute(args: string) {
    const subcommand = args.trim().toLowerCase();

    if (subcommand === 'help') {
      return {
        success: true,
        message: [
          'Vim 编辑模式帮助',
          '==================',
          '',
          '切换 normal（标准编辑）和 vim 编辑模式。',
          '',
          '用法:',
          '  /vim              - 切换 normal / vim 模式',
          '  /vim enable       - 切换到 vim 模式',
          '  /vim disable      - 切换到 normal 模式',
          '  /vim normal       - 切换到 normal 模式（同 disable）',
          '  /vim status       - 显示当前编辑模式',
          '  /vim help         - 显示本帮助',
          '',
          'Vim 模式启用后支持:',
          '  - 普通模式: h/j/k/l/w/b/0/$ 等光标移动',
          '  - 操作符: d（删除）、c（修改）、y（复制）、r（替换）',
          '  - 文本对象: iw（单词内）、ip（段落内）',
          '  - Visual 模式: v 进入可视选择，配合 d/c/y 操作',
          '  - Escape 返回 NORMAL 模式',
          '',
          '当前模式: ' + getCurrentMode(),
        ].join('\n'),
      };
    }

    try {
      const config = configManager.getGlobalConfig();
      let currentMode = config.editorMode || 'normal';

      if (currentMode === 'emacs') {
        currentMode = 'normal';
      }

      let newMode: string;
      let shouldToggle = false;

      if (subcommand === 'status') {
        return {
          success: true,
          message: '当前编辑模式: ' + currentMode,
        };
      } else if (subcommand === 'normal' || subcommand === 'disable') {
        newMode = 'normal';
      } else if (subcommand === 'enable' || subcommand === 'vim') {
        newMode = 'vim';
      } else if (!subcommand) {
        shouldToggle = true;
        newMode = currentMode === 'normal' ? 'vim' : 'normal';
      } else {
        return {
          success: false,
          message:
            '未知参数 "' +
            subcommand +
            '"。\n用法: /vim [normal|enable|disable|status|help]',
        };
      }

      if (newMode === currentMode && !shouldToggle) {
        return {
          success: true,
          message: '编辑模式已经是 ' + newMode + '。',
        };
      }

      configManager.saveGlobalConfig((current: any) => ({
        ...current,
        editorMode: newMode,
      }));

      (await import('@modules/services/analytics/index.js')).logEvent(
        'tengu_editor_mode_changed',
        {
          mode: newMode,
          source: 'command',
        }
      );

      return {
        success: true,
        message: [
          '编辑模式已切换为 ' + newMode + '。',
          newMode === 'vim'
            ? '按 Escape 键在 INSERT 和 NORMAL 模式间切换。'
            : '使用标准键盘绑定。',
        ].join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        message:
          '切换编辑模式失败: ' +
          (error instanceof Error ? error.message : String(error)),
      };
    }
  },
};

/**
 * 获取当前编辑模式
 */
function getCurrentMode(): string {
  try {
    const config = configManager.getGlobalConfig();
    return config.editorMode || 'normal';
  } catch {
    return 'normal';
  }
}

export default vimCommand;
