/**
 * 添加工作目录命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'commands:builtin:add-dir:AddDir', level: LogLevel.INFO });

export default {
  /**
   * 执行添加目录命令
   * @param args 目录路径参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const path = args.trim();

    if (!path) {
      return {
        success: true,
        type: 'text',
        message: [
          '📁 添加工作目录命令',
          '',
          '用法:',
          '  /add-dir <目录路径>    添加指定目录为工作目录',
          '',
          '示例:',
          '  /add-dir /home/projects/my-app',
          '  /add-dir ./src',
          '',
          '提示: 提供要添加的目录路径以更新工作目录。',
        ].join('\n'),
      };
    }

    try {
      // 验证路径
      const fs = await import('fs');
      const fullPath = path.startsWith('/')
        ? path
        : `${context.cwd || process.cwd()}/${path}`;

      if (!fs.existsSync(fullPath)) {
        return {
          success: false,
          type: 'error',
          error: `目录不存在: ${fullPath}`,
        };
      }

      const stats = fs.statSync(fullPath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          type: 'error',
          error: `指定的路径不是目录: ${fullPath}`,
        };
      }

      // 更新工作目录
      if (context.onDone) {
        context.onDone(`工作目录已更新为: ${fullPath}`, { display: 'system' });
      }

      return {
        success: true,
        type: 'text',
        message: `已添加工作目录: ${fullPath}`,
        data: { path: fullPath },
      };
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: `添加目录失败: ${(error as Error).message}`,
      };
    }
  },
};
