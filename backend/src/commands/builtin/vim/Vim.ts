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

/**
 * Vim命令实现
 */
const vimCommand = {
  async execute(args: string) {
    // 解析参数
    const subcommand = args.trim().toLowerCase();

    // 帮助
    if (subcommand === 'help') {
      return {
        success: true,
        message: [
          `Vim Command Help\n==================`,
          ``,
          `Toggle between normal (readline) and vim editing modes.`,
          ``,
          `Usage:`,
          `  /vim              - Toggle between normal and vim mode`,
          `  /vim normal       - Switch to normal (readline) mode`,
          `  /vim enable       - Switch to vim mode`,
          `  /vim status       - Show current editing mode`,
          `  /vim help         - Show this help`,
          ``,
          `When vim mode is enabled:`,
          `  - Normal mode uses vim-style keybindings (h,j,k,l,w,b,etc.)`,
          `  - Press Escape to return to NORMAL mode from INSERT mode`,
          `  - Supports operators: d (delete), c (change), y (yank)`,
          `  - Supports text objects: iw (inner word), ip (inner paragraph)`,
          ``,
          `Current mode: ${getCurrentMode()}`,
        ].join('\n'),
      };
    }

    try {
      const config = configManager.getGlobalConfig();
      let currentMode = config.editorMode || 'normal';

      // 处理向后兼容：将 'emacs' 视为 'normal'
      if (currentMode === 'emacs') {
        currentMode = 'normal';
      }

      let newMode: string;

      // 根据子命令确定新模式
      if (subcommand === 'status') {
        return {
          success: true,
          message: `Current editor mode: ${currentMode}`,
        };
      } else if (subcommand === 'normal') {
        newMode = 'normal';
      } else if (subcommand === 'enable' || subcommand === 'vim') {
        newMode = 'vim';
      } else if (!subcommand) {
        // 无参数：切换模式
        newMode = currentMode === 'normal' ? 'vim' : 'normal';
      } else {
        return {
          success: false,
          error: `Error: Unknown argument "${subcommand}".\nUsage: /vim [normal|enable|status|help]`,
        };
      }

      // 如果模式未变化，提前返回
      if (newMode === currentMode) {
        return {
          success: true,
          message: `Editor mode is already set to ${newMode}.`,
        };
      }

      // 保存配置
      configManager.saveGlobalConfig((current: any) => ({
        ...current,
        editorMode: newMode,
      }));

      return {
        success: true,
        message: [
          `Editor mode set to ${newMode}.`,
          newMode === 'vim'
            ? 'Use Escape key to toggle between INSERT and NORMAL modes.'
            : 'Using standard (readline) keyboard bindings.',
        ].join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: `Error toggling editor mode: ${error instanceof Error ? error.message : String(error)}`,
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
