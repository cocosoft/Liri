/**
 * Export命令
 * 导出对话记录到文件
 *

 * Liri 扩展为纯文本子命令形式：/export [help|status]
 */

import { join } from 'path';
import { writeFileSync } from 'fs';
import { resolveDataDir } from '@modules/core/paths';
import type { CommandContext } from '@modules/commands/types';

interface MsgLike {
  type?: string;
  role?: string;
  content?: unknown;
  timestamp?: string;
}

/**
 * 格式化时间戳
 */
function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
}

/**
 * 格式化友好的时间戳（用于显示）
 */
function formatHumanDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

/**
 * 净化文件名，移除特殊字符
 */
function sanitizeFilename(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60);
}

/**
 * 提取第一条用户消息的文本内容，用于生成文件名
 */
function extractFirstPrompt(context: CommandContext): string {
  const messages = (context.messages || []) as MsgLike[];
  if (!messages.length) {
    return '';
  }

  const firstUser = messages.find(
    (m) => m.type === 'user' || m.role === 'user'
  );
  if (!firstUser) {
    return '';
  }

  const content = firstUser.content;
  if (typeof content === 'string') {
    return content.trim().split('\n')[0]?.substring(0, 50) || '';
  }

  if (Array.isArray(content)) {
    const textBlock = content.find(
      (item: { type?: string; text?: string }) => item.type === 'text'
    );
    if (textBlock && typeof textBlock.text === 'string') {
      return textBlock.text.trim().split('\n')[0]?.substring(0, 50) || '';
    }
  }

  return '';
}

/**
 * 渲染消息为纯文本
 */
function renderMessages(context: CommandContext): string {
  const lines: string[] = [];
  lines.push('Liri 对话导出');
  lines.push('='.repeat(50));
  lines.push(`导出时间: ${formatHumanDate(new Date())}`);
  lines.push('');

  const messages = (context.messages || []) as MsgLike[];
  if (!messages.length) {
    return lines.join('\n');
  }

  for (const msg of messages) {
    const role = msg.type === 'user' || msg.role === 'user' ? '用户' : 'Liri';
    lines.push(`[${role}]`);

    if (typeof msg.content === 'string') {
      lines.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          lines.push(block.text);
        } else if (block.type === 'tool_use') {
          lines.push(`[工具调用: ${block.name}]`);
        } else if (block.type === 'tool_result') {
          lines.push(`[工具结果]`);
          if (typeof block.content === 'string') {
            lines.push(block.content);
          }
        } else if (
          block.type === 'thinking' &&
          typeof block.thinking === 'string'
        ) {
          lines.push(block.thinking);
        }
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 导出命令实现
 */
const exportCommand = {
  async execute(args: string, context: CommandContext) {
    const trimmed = args.trim();

    try {
      if (trimmed === 'help') {
        return handleHelp();
      }

      if (trimmed === 'status') {
        return handleStatus(context);
      }

      if (trimmed === '--json') {
        return handleJsonExport(context);
      }

      return handleExport(trimmed, context);
    } catch (error) {
      return {
        success: false,
        message: `导出失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },
};

/**
 * 处理 help 子命令
 */
async function handleHelp() {
  return {
    success: true,
    message: [
      '导出对话帮助',
      '==============',
      '',
      '将当前对话记录导出到文件。',
      '',
      '用法:',
      '  /export              - 导出对话（使用智能文件名）',
      '  /export <文件名>     - 导出对话到指定文件',
      '  /export status       - 显示导出状态',
      '  /export --json       - 以 JSON 格式导出对话',
      '  /export help         - 显示本帮助',
      '',
      '文件名规则:',
      '  - 不提供文件名时，自动从首条消息提取关键词生成文件名',
      '  - 若首条消息为空，使用 conversation-时间戳.txt',
      '  - 提供文件名但无 .txt 扩展名，自动添加',
      '  - 文件保存在当前工作目录下',
      '',
      '导出格式:',
      '  纯文本格式：包含对话时间、角色标记',
      '  JSON 格式：结构化数据，包含元信息',
      '',
      '示例:',
      '  /export',
      '  /export my-conversation',
      '  /export chat-log.txt',
      '  /export status',
      '',
      '别名: /导出',
    ].join('\n'),
  };
}

/**
 * 处理 status 子命令
 */
async function handleStatus(context: CommandContext) {
  const msgCount =
    context.messages && Array.isArray(context.messages)
      ? context.messages.length
      : 0;

  return {
    success: true,
    message: [
      '导出状态',
      '==============',
      '',
      `对话消息数: ${msgCount}`,
      `导出目录: ${resolveDataDir()}`,
      `默认编码: UTF-8`,
      `支持格式: 纯文本 (.txt), JSON (.json)`,
      '',
      `可用导出: /export, /export <文件名>, /export --json`,
    ].join('\n'),
  };
}

/**
 * 处理 JSON 格式导出
 */
async function handleJsonExport(context: CommandContext) {
  const timestamp = formatTimestamp(new Date());
  const filename = `conversation-${timestamp}.json`;
  const filepath = join(resolveDataDir(), filename);

  const messages = (context.messages || []) as MsgLike[];

  const exportData = {
    app: 'Liri',
    exportTime: new Date().toISOString(),
    messageCount: messages.length,
    messages: messages.map((msg) => ({
      role: msg.type === 'user' || msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
      timestamp: msg.timestamp,
    })),
  };

  writeFileSync(filepath, JSON.stringify(exportData, null, 2), {
    encoding: 'utf-8',
  });

  (await import('@modules/services/analytics/index.js')).logEvent(
    'tengu_export_created',
    {
      format: 'json',
      messageCount: exportData.messageCount,
    }
  );

  return {
    success: true,
    message: `对话已导出为 JSON: ${filepath}`,
  };
}

/**
 * 处理文件导出
 */
async function handleExport(filenameArg: string, context: CommandContext) {
  const content = renderMessages(context);

  let filepath: string;

  if (filenameArg) {
    const finalFilename = filenameArg.endsWith('.txt')
      ? filenameArg
      : filenameArg.replace(/\.[^.]+$/, '') + '.txt';
    filepath = join(resolveDataDir(), finalFilename);
  } else {
    const firstPrompt = extractFirstPrompt(context);
    const timestamp = formatTimestamp(new Date());
    let defaultFilename: string;

    if (firstPrompt) {
      const sanitized = sanitizeFilename(firstPrompt);
      defaultFilename = sanitized
        ? `${timestamp}-${sanitized}.txt`
        : `conversation-${timestamp}.txt`;
    } else {
      defaultFilename = `conversation-${timestamp}.txt`;
    }

    filepath = join(resolveDataDir(), defaultFilename);
  }

  writeFileSync(filepath, content, { encoding: 'utf-8' });

  (await import('@modules/services/analytics/index.js')).logEvent(
    'tengu_export_created',
    {
      format: 'text',
      messageCount: context.messages?.length || 0,
      hasCustomName: !!filenameArg,
    }
  );

  return {
    success: true,
    message: `对话已导出到: ${filepath}`,
  };
}

export default exportCommand;
