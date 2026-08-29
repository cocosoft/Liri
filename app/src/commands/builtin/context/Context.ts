/**
 * 上下文管理命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import { compactionMetricsTracker } from '../../../context/compaction/CompactionMetrics';
import { estimateMessagesTokens } from '@modules/ai';
import { autoCompactionPolicy } from '../../../context/compaction/AutoCompactionPolicy';
import type { ContextSnapshot } from '../../../context/compaction/CompactionMetrics';
import { analyzeContextUsage, formatWalletBreakdown } from './ContextWallet';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('commands:builtin:context:Context');

interface ChatManagerLike {
  clearContext(): Promise<void>;
  getContextInfo(): Promise<Record<string, unknown>>;
  compactContext(): Promise<Record<string, unknown>>;
  trimContext(tokens: number): Promise<Record<string, unknown>>;
}

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
      case 'history':
        return this.handleHistory(options);
      case 'snapshot':
        return this.handleSnapshot(context);
      case 'debug':
        return this.handleDebug();
      case 'wallet':
        return this.handleWallet(context);
      default:
        return this.handleHelp();
    }
  },

  /**
   * 清空上下文
   */
  async handleClear(context: CommandContext): Promise<CommandResult> {
    const cm = context.chatManager as ChatManagerLike | undefined;
    if (cm) {
      try {
        await cm.clearContext();
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
    const cm = context.chatManager as ChatManagerLike | undefined;
    if (cm) {
      try {
        const contextInfo = await cm.getContextInfo();
        const summary =
          `上下文信息:\n` +
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
    const cm = context.chatManager as ChatManagerLike | undefined;
    if (cm) {
      try {
        const result = await cm.compactContext();
        context.onDone?.(
          `上下文已压缩，节省 ${result.savedTokens || 0} tokens`,
          { display: 'system' }
        );
        return {
          success: true,
          type: 'text',
          message:
            `上下文压缩完成\n` +
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

    const infoStr =
      `会话上下文信息:\n` +
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
  async handleTrim(
    options: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    const targetSize = parseInt(options[0]) || 1000;

    if (context.chatManager) {
      const cm = context.chatManager as ChatManagerLike;
      try {
        const result = await cm.trimContext(targetSize);
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
   * 显示压缩历史（/context history [N]）
   * Phase 5: 诊断命令 — 最近 N 次压缩记录
   */
  async handleHistory(options: string[]): Promise<CommandResult> {
    const n = parseInt(options[0]) || 10;
    const history = compactionMetricsTracker.formatHistory(n);

    return {
      success: true,
      type: 'text',
      message: history,
      data: compactionMetricsTracker.getHistory(n),
    };
  },

  /**
   * 显示当前上下文快照（/context snapshot）
   * Phase 5: 诊断命令 — 当前上下文状态
   */
  async handleSnapshot(context: CommandContext): Promise<CommandResult> {
    const summary = compactionMetricsTracker.getSummary();
    const messagesContextInfo = await this.tryGetContextInfo(context);

    const snapshot: ContextSnapshot = {
      sessionId: (context.sessionId as string) || 'unknown',
      messageCount: messagesContextInfo?.messageCount || 0,
      estimatedTokens: messagesContextInfo?.tokenCount || 0,
      compressionTier:
        summary.byTier[3] > 0
          ? 3
          : summary.byTier[2] > 0
            ? 2
            : summary.byTier[1] > 0
              ? 1
              : 0,
      memoryUsage: `${summary.total} compactions total`,
      lastActivity: new Date().toISOString(),
    };

    return {
      success: true,
      type: 'text',
      message: compactionMetricsTracker.formatSnapshot(snapshot),
      data: snapshot,
    };
  },

  /**
   * 显示压缩决策树（/context debug）
   * Phase 5: 诊断命令 — 压缩策略调试
   */
  async handleDebug(): Promise<CommandResult> {
    const debugTree = compactionMetricsTracker.formatDebugTree();

    return {
      success: true,
      type: 'text',
      message: debugTree,
      data: compactionMetricsTracker.getSummary(),
    };
  },

  /**
   * 安全获取上下文信息（不抛异常）
   */
  async tryGetContextInfo(
    context: CommandContext
  ): Promise<{ messageCount: number; tokenCount: number } | null> {
    try {
      const cm = context.chatManager as ChatManagerLike | undefined;
      if (cm) {
        const info = await cm.getContextInfo();
        return {
          messageCount: (info.messageCount as number) || 0,
          tokenCount: (info.tokenCount as number) || 0,
        };
      }
    } catch {
      // 静默回退
    }
    return null;
  },

  /**
   * 上下文钱包可视化（P1-14）
   * 按类别分解 Token 用量 + 生成优化建议
   */
  async handleWallet(context: CommandContext): Promise<CommandResult> {
    const sessionId = (context.sessionId as string) || 'unknown';
    try {
      const breakdown = await analyzeContextUsage(sessionId);
      const formatted = formatWalletBreakdown(breakdown);

      context.onDone?.('上下文钱包分析完成', { display: 'system' });
      return {
        success: true,
        type: 'text',
        message: formatted,
        data: breakdown,
      };
    } catch (error) {
      return {
        success: false,
        type: 'error',
        error: `钱包分析失败: ${(error as Error).message}`,
      };
    }
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
/context history [N] - 显示最近 N 次压缩历史（默认 10）
/context snapshot  - 显示当前上下文快照
/context debug     - 显示压缩决策树诊断
/context wallet    - 上下文钱包可视化（Token 分解 + 优化建议）

示例:
  /context show
  /context clear
  /context trim 2000
  /context history 5
  /context snapshot
  /context debug`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
