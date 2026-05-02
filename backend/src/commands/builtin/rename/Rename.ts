/**
 * 重命名会话命令实现
 */
import type { CommandContext, CommandResult } from '../../types/index.js';

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
        success: false,
        type: 'error',
        error: '请提供新的会话名称',
        message: '用法: /rename <新名称>',
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
        const oldName = await context.chatManager.getSessionName(context.sessionId);
        await context.chatManager.renameSession(context.sessionId, newName);
        
        context.onDone?.(`会话已重命名: ${oldName || '未命名'} -> ${newName}`, { display: 'system' });
        
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
