/**
 * Logout命令执行逻辑
 * 处理用户登出流程
 * 参考CC源码 cc_code/backend/commands/logout/logout.ts 实现
 */

import type { CommandContext, CommandResult } from '@modules/commands';
import { configManager } from '@modules/config';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'commands:logout:logout',
  level: LogLevel.INFO,
});

/**
 * 执行登出
 */
export async function executeLogout(
  _args: string,
  _context: CommandContext
): Promise<CommandResult> {
  try {
    // 清除API Key
    const hadToken = !!(
      configManager.env('Liri_API_KEY') ||
      configManager.env('ANTHROPIC_API_KEY')
    );

    delete process.env.Liri_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    // 清除其他认证相关环境变量
    delete process.env.Liri_SESSION_TOKEN;
    delete process.env.Liri_REFRESH_TOKEN;

    if (hadToken) {
      return {
        type: 'text',
        success: true,
        message: '已成功登出',
      };
    } else {
      return {
        type: 'text',
        success: true,
        message: '当前未登录',
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      type: 'error',
      success: false,
      message: `登出失败: ${errorMessage}`,
    };
  }
}
