/**
 * Fast 命令实现 - 快速模式切换
 *
 * 对标 CC 源码 cc_code/backend/commands/fast/fast.tsx
 * CC 中以 React FastModePicker 组件展示快速模式面板，
 * PY_APP 使用 CLI 文本输出。
 *
 * 快速模式通过切换 AI 模型（如切换到更快更便宜的模型）来实现
 * 更短的响应时间，状态持久化到 ConfigManager。
 */

import { configManager } from '@modules/config/ConfigManager.js';
import type { CommandContext, CommandResult } from '@modules/commands/types';

/**
 * 快速模式状态缓存键
 */
const FAST_MODE_KEY = 'fastMode';

/**
 * 快速模式命令实现
 */
const fastCommand = {
  /**
   * 执行 fast 命令
   * @param args 子命令参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    const trimmed = args.trim().toLowerCase();

    if (trimmed === 'help') {
      return handleHelp();
    }

    if (trimmed === 'status') {
      return handleStatus();
    }

    if (trimmed === '--json') {
      return handleJson();
    }

    try {
      const config = configManager.getGlobalConfig();
      const isEnabled = (config as any)[FAST_MODE_KEY] === true;

      if (trimmed === 'off' || trimmed === 'disable') {
        if (!isEnabled) {
          return { success: true, message: '快速模式已经是禁用状态。' };
        }
        return handleToggle(false, config);
      }

      if (trimmed === 'on' || trimmed === 'enable') {
        if (isEnabled) {
          return { success: true, message: '快速模式已经是启用状态。' };
        }
        return handleToggle(true, config);
      }

      if (!trimmed) {
        const newMode = !isEnabled;
        return handleToggle(newMode, config);
      }

      return {
        success: true,
        message: `未知参数 "${args.trim()}"。\n用法: /fast [on|off|status|--json|help]`,
      };
    } catch (error) {
      return {
        success: false,
        message: `快速模式操作失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },
};

/**
 * 处理帮助子命令
 */
function handleHelp(): CommandResult {
  return {
    success: true,
    message: [
      '快速模式帮助',
      '==============',
      '',
      '切换 AI 模型的快速模式。启用后使用专门优化模型提供更快的响应速度，',
      '降低交互延迟，适用于对速度要求较高的场景。',
      '',
      '用法:',
      '  /fast              - 切换快速模式开关',
      '  /fast on (enable)  - 启用快速模式',
      '  /fast off (disable)- 禁用快速模式',
      '  /fast status       - 显示快速模式状态',
      '  /fast --json       - 以 JSON 格式输出状态',
      '  /fast help         - 显示本帮助',
      '',
      '功能说明:',
      '  - 快速模式：启用后使用专门的快速响应模型，减少延迟',
      '  - 状态持久化：快速模式状态自动保存，重启后保持',
      '  - 实时查看：使用 /fast status 查看当前状态',
      '',
      '当前状态: ' + getFastStatusText(),
    ].join('\n'),
  };
}

/**
 * 处理 status 子命令
 */
function handleStatus(): CommandResult {
  return {
    success: true,
    message: [
      '快速模式状态',
      '==============',
      '',
      '状态: ' + getFastStatusText(),
      'Node.js: ' + process.version,
      '平台: ' + process.platform + ' ' + process.arch,
      '',
      '用法:',
      '  /fast on  - 启用快速模式',
      '  /fast off - 禁用快速模式',
    ].join('\n'),
  };
}

/**
 * 处理 --json 子命令
 */
function handleJson(): CommandResult {
  const config = configManager.getGlobalConfig();
  const isEnabled = (config as any)[FAST_MODE_KEY] === true;

  const data = {
    command: 'fast',
    fastMode: isEnabled,
    status: isEnabled ? 'enabled' : 'disabled',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    timestamp: Date.now(),
  };

  return {
    success: true,
    message: JSON.stringify(data, null, 2),
  };
}

/**
 * 处理切换快速模式
 * @param enabled 是否启用
 * @param _config 当前配置
 */
async function handleToggle(
  enabled: boolean,
  _config: any
): Promise<CommandResult> {
  configManager.saveGlobalConfig((current: any) => ({
    ...current,
    [FAST_MODE_KEY]: enabled,
  }));

  (await import('@modules/services/analytics/index.js')).logEvent(
    'tengu_fast_mode_toggled',
    {
      enabled,
      source: 'command',
    }
  );

  const icon = enabled ? '⚡' : '';
  const message = enabled
    ? `${icon} 快速模式已启用。响应速度将更快，使用专门的快速响应模型。`
    : '快速模式已禁用。恢复到标准响应模式。';

  return { success: true, message };
}

/**
 * 获取快速模式状态文本
 */
function getFastStatusText(): string {
  const config = configManager.getGlobalConfig();
  const isEnabled = (config as any)[FAST_MODE_KEY] === true;
  return isEnabled ? '✅ 已启用' : '⬜ 已禁用';
}

export default fastCommand;
