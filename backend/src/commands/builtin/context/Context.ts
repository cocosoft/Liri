/**
 * 上下文管理命令实现
 */
import type { CommandContext, CommandResult } from '../../types/index.js';

export default {
  /**
   * 执行上下文命令
   * @param args 子命令参数 (clear, show, compact, etc.)
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(' ');
    const subcommand = parts[0] || 'show';
    const options = parts.slice(1);

    switch (subcommand.toLowerCase()) {
      case 'clear':
        return this.handleClear(context);
      case 'show':
        return this.handleShow(context);
      case 'compact':
        return this.handleCompact(context);
      case 'info':
        return this.handleInfo(context);
      case 'trim':
        return this.handleTrim(options, context);
      default:
        return this.handleHelp();
    }
  },

  /**
   * 清空上下文
   */
  async handleClear(context: CommandContext): Promise<CommandResult> {
    if (context.chatManager) {
      try {
        await context.chatManager.clearContext();
        context.onDone?.('上下文已清空', { display: 'system' });
        return {
          success: true,
          type: 'text',
          message: '上下文已清空',
        };
      } catch (error) {
        return {
          success: false,
          type: 'error',
          error: `清空上下文失败: ${(error as Error).message}`,
        };
      }
    }
    return {
      success: false,
      type: 'error',
      error: '无法访问聊天管理器',
    };
  },

  /**
   * 显示上下文信息
   */
  async handleShow(context: CommandContext): Promise<CommandResult> {
    if (context.chatManager) {
      try {
        const contextInfo = await context.chatManager.getContextInfo();
        const summary = `上下文信息:\n` +
          `- 消息数量: ${contextInfo.messageCount || 0}\n` +
          `- Token数量: ${contextInfo.tokenCount || 0}\n` +
          `- 上下文长度: ${contextInfo.contextLength || 0} 字符\n` +
          `- 会话ID: ${context.sessionId || 'N/A'}`;
        
        return {
          success: true,
          type: 'text',
          message: summary,
          data: contextInfo,
        };
      } catch (error) {
        return {
          success: false,
          type: 'error',
          error: `获取上下文信息失败: ${(error as Error).message}`,
        };
      }
    }
    return {
      success: false,
      type: 'error',
      error: '无法访问聊天管理器',
    };
  },

  /**
   * 压缩上下文
   */
  async handleCompact(context: CommandContext): Promise<CommandResult> {
    if (context.chatManager) {
      try {
        const result = await context.chatManager.compactContext();
        context.onDone?.(`上下文已压缩，节省 ${result.savedTokens || 0} tokens`, { display: 'system' });
        return {
          success: true,
          type: 'text',
          message: `上下文压缩完成\n` +
            `- 原始Token: ${result.originalTokens || 0}\n` +
            `- 压缩后Token: ${result.compactedTokens || 0}\n` +
            `- 节省Token: ${result.savedTokens || 0}`,
          data: result,
        };
      } catch (error) {
        return {
          success: false,
          type: 'error',
          error: `压缩上下文失败: ${(error as Error).message}`,
        };
      }
    }
    return {
      success: false,
      type: 'error',
      error: '无法访问聊天管理器',
    };
  },

  /**
   * 获取详细信息
   */
  async handleInfo(context: CommandContext): Promise<CommandResult> {
    const info = {
      sessionId: context.sessionId,
      userId: context.userId,
      projectId: context.projectId,
      cwd: context.cwd,
      environment: Object.keys(context.environment || {}).length,
    };
    
    const infoStr = `会话上下文信息:\n` +
      `- 会话ID: ${info.sessionId || 'N/A'}\n` +
      `- 用户ID: ${info.userId || 'N/A'}\n` +
      `- 项目ID: ${info.projectId || 'N/A'}\n` +
      `- 工作目录: ${info.cwd || 'N/A'}\n` +
      `- 环境变量数: ${info.environment}`;

    return {
      success: true,
      type: 'text',
      message: infoStr,
      data: info,
    };
  },

  /**
   * 裁剪上下文到指定大小
   */
  async handleTrim(options: string[], context: CommandContext): Promise<CommandResult> {
    const targetSize = parseInt(options[0]) || 1000;
    
    if (context.chatManager) {
      try {
        const result = await context.chatManager.trimContext(targetSize);
        return {
          success: true,
          type: 'text',
          message: `上下文已裁剪到 ${targetSize} tokens`,
          data: result,
        };
      } catch (error) {
        return {
          success: false,
          type: 'error',
          error: `裁剪上下文失败: ${(error as Error).message}`,
        };
      }
    }
    return {
      success: false,
      type: 'error',
      error: '无法访问聊天管理器',
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `上下文管理命令用法:

/context show      - 显示当前上下文信息
/context clear     - 清空上下文
/context compact   - 压缩上下文（使用LLM摘要）
/context info      - 显示详细会话信息
/context trim <n>  - 裁剪上下文到n tokens

示例:
  /context show
  /context clear
  /context trim 2000`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
