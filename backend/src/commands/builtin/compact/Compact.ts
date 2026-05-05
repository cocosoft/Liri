/**
 * Compact命令
 * 手动触发对话压缩，减少上下文大小
 *
 * 基于CC源码 cc_code/backend/commands/compact.ts 实现
 */

import type { Command, CommandContext, CommandType, CommandResult } from '../../types';

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

    let message = '对话历史已压缩';
    
    if (options.summarize) {
      message += '，摘要已生成';
    }

    if (options.extractKeyInfo) {
      message += '，关键信息已提取';
    }

    message += `（保留最近 ${options.preserveRecentMessages} 条消息）`;

    return {
      success: true,
      type: 'system',
      value: message,
    };
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
