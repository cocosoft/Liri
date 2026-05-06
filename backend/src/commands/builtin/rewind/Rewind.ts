/**
 * 回退会话命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

export default {
  /**
   * 执行回退命令
   * @param args 回退步数或消息ID
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const arg = args.trim();
    let steps = 1; // 默认回退1步
    
    if (arg) {
      const parsed = parseInt(arg);
      if (!isNaN(parsed) && parsed > 0) {
        steps = parsed;
      } else {
        // 可能是消息ID，尝试作为消息ID处理
        return this.handleRewindToMessage(arg, context);
      }
    }

    return this.handleRewindSteps(steps, context);
  },

  /**
   * 按步数回退
   */
  async handleRewindSteps(steps: number, context: CommandContext): Promise<CommandResult> {
    try {
      if (context.chatManager) {
        const result = await context.chatManager.rewindSession(context.sessionId, steps);
        
        if (result.success) {
          context.onDone?.(`会话已回退 ${steps} 步`, { display: 'system' });
          return {
            success: true,
            type: 'text',
            message: `会话已回退 ${steps} 步`,
            data: result,
          };
        } else {
          return {
            success: false,
            type: 'error',
            error: result.error || '回退失败',
          };
        }
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
        error: `回退会话失败: ${(error as Error).message}`,
      };
    }
  },

  /**
   * 回退到指定消息
   */
  async handleRewindToMessage(messageId: string, context: CommandContext): Promise<CommandResult> {
    try {
      if (context.chatManager) {
        const result = await context.chatManager.rewindToMessage(context.sessionId, messageId);
        
        if (result.success) {
          context.onDone?.(`会话已回退到消息 ${messageId}`, { display: 'system' });
          return {
            success: true,
            type: 'text',
            message: `会话已回退到消息 ${messageId}`,
            data: result,
          };
        } else {
          return {
            success: false,
            type: 'error',
            error: result.error || '回退失败',
          };
        }
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
        error: `回退会话失败: ${(error as Error).message}`,
      };
    }
  },
};
