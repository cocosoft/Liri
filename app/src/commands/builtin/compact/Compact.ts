/**
 * Compact命令
 * 手动触发对话压缩，减少上下文大小
 *
 * Phase 5: 移除 DefaultContextEngine 死代码引用。
 *   实际压缩由 ChatManager.compactSession → CompactionOrchestrator 完成。
 */

import type {
  Command,
  CommandContext,
  CommandType,
  CommandResult,
} from '@modules/commands';
import type { CompactArtifact } from '@modules/services/compact/CompactService';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'commands:builtin:compact',
  level: LogLevel.INFO,
});

export interface CompactCommandOptions {
  preserveRecentMessages?: number;
  summarize?: boolean;
  extractKeyInfo?: boolean;
}

export class CompactCommand implements Command {
  type: CommandType = 'action';
  name = 'compact';
  description = '手动压缩对话历史，减少上下文大小';
  aliases = ['compress', 'shrink'];
  argumentHint =
    '[--preserve-recent <number>] [--summarize] [--extract-key-info]';

  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const argArray = args.trim().split(/\s+/);
    const options = this.parseOptions(argArray);

    try {
      const { sessionId } = context;
      const chatManager = context.chatManager as
        | {
            compactSession: (sessionId?: string) => Promise<CompactArtifact[]>;
          }
        | undefined;

      if (!chatManager) {
        return {
          success: false,
          type: 'error',
          value: '无法执行压缩：聊天管理器不可用',
        };
      }

      // 委托 ChatManager.compactSession → CompactionOrchestrator（Tier1/2/3）
      const artifacts = await chatManager.compactSession(sessionId);

      // 构建返回消息
      let message = '对话历史已压缩';

      const hasSummary = artifacts.some(
        (a: CompactArtifact) => a.type === 'summary'
      );
      const hasKeyInfo = artifacts.some((a: CompactArtifact) =>
        ['key_point', 'code_snippet', 'decision', 'action_item'].includes(
          a.type
        )
      );

      if (options.summarize && hasSummary) {
        message += '，摘要已生成';
      }

      if (options.extractKeyInfo && hasKeyInfo) {
        message += '，关键信息已提取';
      }

      message += `（保留最近 ${options.preserveRecentMessages} 条消息）`;

      return {
        success: true,
        type: 'system',
        value: message,
        data: {
          artifacts,
          preservedMessages: options.preserveRecentMessages,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        type: 'error',
        value: `压缩失败：${errorMsg}`,
      };
    }
  }

  private parseOptions(args: string[]): CompactCommandOptions {
    const options: CompactCommandOptions = {
      preserveRecentMessages: 5,
      summarize: true,
      extractKeyInfo: true,
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i].toLowerCase();
      if (arg === '--preserve-recent' && i + 1 < args.length) {
        const num = parseInt(args[i + 1], 10);
        if (!isNaN(num) && num >= 0) {
          options.preserveRecentMessages = num;
          i++;
        }
      } else if (arg === '--no-summarize') {
        options.summarize = false;
      } else if (arg === '--no-extract-key-info') {
        options.extractKeyInfo = false;
      }
    }

    return options;
  }
}
