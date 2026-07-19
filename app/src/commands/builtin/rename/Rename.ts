/**
 * 重命名会话命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'commands:builtin:rename:Rename',
  level: LogLevel.INFO,
});

export default {
  /**
   * 执行重命名命令
   * @param args 新会话名称
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const newName = args.trim();

    if (!newName) {
      return {
        success: true,
        type: 'text',
        message: [
          '✏️ 重命名会话命令',
          '',
          '用法:',
          '  /rename <新名称>    重命名当前会话',
          '',
          '要求:',
          '  - 名称长度不超过 100 个字符',
          '  - 不能包含字符: \\ / : * ? " < > |',
          '',
          '示例:',
          '  /rename 登录功能开发',
          '  /rename Bug修复-2026-05',
        ].join('\n'),
      };
    }

    // 验证名称格式
    if (newName.length > 100) {
      return {
        success: false,
        type: 'error',
        error: '会话名称不能超过100个字符',
      };
    }

    const invalidChars = /[\\/:*?"<>|]/;
    if (invalidChars.test(newName)) {
      return {
        success: false,
        type: 'error',
        error: '会话名称不能包含以下字符: \\ / : * ? " < > |',
      };
    }

    try {
      if (context.chatManager) {
        const cm = context.chatManager as {
          getSessionName: (sessionId?: string) => Promise<string>;
          renameSession: (
            sessionId: string | undefined,
            name: string
          ) => Promise<void>;
        };
        const oldName = await cm.getSessionName(context.sessionId);
        await cm.renameSession(context.sessionId, newName);

        context.onDone?.(`会话已重命名: ${oldName || '未命名'} -> ${newName}`, {
          display: 'system',
        });

        return {
          success: true,
          type: 'text',
          message: `会话已重命名为: ${newName}`,
          data: { oldName, newName },
        };
      }

      return {
        success: false,
        type: 'error',
        error: '无法访问聊天管理器',
      };
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: `重命名会话失败: ${(error as Error).message}`,
      };
    }
  },
};
