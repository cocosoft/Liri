// @ts-nocheck
/**
 * Share命令
 * 分享对话记录
 *
 * 基于CC源码 cc_code/backend/commands/share/index.js 实现
 */

import { join } from 'path';
import { writeFileSync } from 'fs';
import type { Command, CommandContext, CommandType } from '../../types';

export class ShareCommand implements Command {
  type: CommandType = 'action';
  name = 'share';
  description = '分享当前对话';
  aliases = ['分享'];
  argumentHint = '';

  async execute(args: string, context: CommandContext): Promise<void> {
    const content = this.renderShareContent(context);

    try {
      const filepath = await this.saveToFile(content);
      console.log(`对话已保存，可分享文件: ${filepath}`);
    } catch (error) {
      console.log(`分享失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  private renderShareContent(context: CommandContext): string {
    const lines: string[] = [];
    lines.push('PY_APP 对话分享');
    lines.push('='.repeat(50));
    lines.push(`分享时间: ${new Date().toLocaleString()}`);
    lines.push('');

    if (context.messages && Array.isArray(context.messages)) {
      for (const msg of context.messages) {
        const role = msg.type === 'user' ? '用户' : 'Claude';
        lines.push(`### ${role}`);
        if (typeof msg.content === 'string') {
          lines.push(msg.content);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private async saveToFile(content: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `share-${timestamp}.md`;
    const filepath = join(process.cwd(), filename);

    writeFileSync(filepath, content, { encoding: 'utf-8' });

    return filepath;
  }
}