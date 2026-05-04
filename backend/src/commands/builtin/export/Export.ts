// @ts-nocheck
/**
 * Export命令
 * 导出对话记录到文件
 *
 * 基于CC源码 cc_code/backend/commands/export/export.tsx 实现
 */

import { join } from 'path';
import { writeFileSync } from 'fs';
import type { Command, CommandContext, CommandType } from '../../types';

function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
}

function sanitizeFilename(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export class ExportCommand implements Command {
  type: CommandType = 'action';
  name = 'export';
  description = '导出对话记录到文件';
  aliases = ['导出'];
  argumentHint = '[filename]';

  async execute(args: string, context: CommandContext): Promise<void> {
    const filename = args.trim();

    if (filename) {
      const finalFilename = filename.endsWith('.txt')
        ? filename
        : filename.replace(/\.[^.]+$/, '') + '.txt';
      const filepath = join(process.cwd(), finalFilename);

      try {
        const content = this.renderMessages(context);
        writeFileSync(filepath, content, { encoding: 'utf-8' });
        console.log(`对话已导出到: ${filepath}`);
      } catch (error) {
        console.log(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
      return;
    }

    const timestamp = formatTimestamp(new Date());
    const defaultFilename = `conversation-${timestamp}.txt`;
    const filepath = join(process.cwd(), defaultFilename);

    try {
      const content = this.renderMessages(context);
      writeFileSync(filepath, content, { encoding: 'utf-8' });
      console.log(`对话已导出到: ${filepath}`);
    } catch (error) {
      console.log(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  private renderMessages(context: CommandContext): string {
    const lines: string[] = [];
    lines.push('PY_APP 对话导出');
    lines.push('='.repeat(50));
    lines.push(`导出时间: ${new Date().toLocaleString()}`);
    lines.push('');

    if (context.messages && Array.isArray(context.messages)) {
      for (const msg of context.messages) {
        const role = msg.type === 'user' ? '用户' : 'Claude';
        lines.push(`[${role}]`);
        if (typeof msg.content === 'string') {
          lines.push(msg.content);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }
}