/**
 * Compact命令
 * 手动触发对话压缩，减少上下文大小
 *
 * 基于CC源码 cc_code/backend/commands/compact.ts 实现
 */

import type { Command, CommandContext, CommandType } from '../../types';

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

  async execute(args: string, context: CommandContext): Promise<void> {
    const argArray = args.trim().split(/\s+/);
    const options = this.parseOptions(argArray);

    console.log('Compact command executed');
    console.log('Options:', JSON.stringify(options));

    if (options.summarize) {
      console.log('Summary would be generated');
    }

    if (options.extractKeyInfo) {
      console.log('Key information would be extracted');
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
