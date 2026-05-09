/**
 * Share命令
 * 分享对话记录到 Markdown 文件
 *
 * 对标 CC 源码 cc_code/backend/commands/share/index.js
 * CC 中 share 为禁用 stub，PY_APP 实现为完整功能命令：
 * /share [filename|help|status|--json]
 */

import { join } from 'path';
import { writeFileSync } from 'fs';
import type { CommandContext } from '@modules/commands/types';

/**
 * 格式化时间戳用于文件名
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
 * 提取内容纯文本（递归遍历 ContentBlock）
 */
function extractTextFromContent(content: any): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block.type === 'text' && typeof block.text === 'string') {
          return block.text;
        }
        if (block.type === 'thinking' && typeof block.thinking === 'string') {
          return block.thinking;
        }
        if (block.type === 'tool_use') {
          return `[工具调用: ${block.name}]`;
        }
        if (block.type === 'tool_result') {
          if (typeof block.content === 'string') {
            return `[工具结果]\n${block.content}`;
          }
          return '[工具结果]';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

/**
 * 渲染分享内容为 Markdown
 */
function renderShareContent(context: CommandContext): string {
  const lines: string[] = [];
  lines.push('# PY_APP 对话分享');
  lines.push('');
  lines.push(`> 分享时间: ${formatHumanDate(new Date())}`);
  lines.push('');

  if (!context.messages || !Array.isArray(context.messages)) {
    return lines.join('\n');
  }

  for (const msg of context.messages) {
    const role = msg.type === 'user' || msg.role === 'user' ? '用户' : 'Claude';
    const content = extractTextFromContent(msg.content);

    if (content.trim()) {
      lines.push(`## ${role}`);
      lines.push('');
      lines.push(content);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * 渲染分享内容为 JSON
 */
function renderShareJson(context: CommandContext): string {
  const messages = (context.messages || []).map((msg) => ({
    role: msg.type === 'user' || msg.role === 'user' ? 'user' : 'assistant',
    content: extractTextFromContent(msg.content),
    timestamp: msg.timestamp,
  }));

  const data = {
    app: 'PY_APP',
    shareTime: new Date().toISOString(),
    format: 'markdown',
    messageCount: messages.length,
    messages,
  };

  return JSON.stringify(data, null, 2);
}

/**
 * 保存内容到文件
 */
async function saveToFile(content: string, filename: string): Promise<string> {
  const filepath = join(process.cwd(), filename);
  writeFileSync(filepath, content, { encoding: 'utf-8' });
  return filepath;
}

/**
 * 分享命令实现
 */
const shareCommand = {
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
        return handleJsonShare(context);
      }

      return handleShare(trimmed, context);
    } catch (error) {
      return {
        success: false,
        message: `分享失败: ${error instanceof Error ? error.message : '未知错误'}`,
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
      '分享对话帮助',
      '==============',
      '',
      '将当前对话分享为 Markdown 文件，方便传播和阅读。',
      '',
      '用法:',
      '  /share              - 分享对话（自动文件名）',
      '  /share <文件名>     - 分享到指定文件',
      '  /share status       - 显示分享状态',
      '  /share --json       - 同时生成 JSON 格式',
      '  /share help         - 显示本帮助',
      '',
      '文件名规则:',
      '  - 不提供文件名时，使用 share-时间戳.md',
      '  - 提供文件名但无 .md 扩展名，自动添加',
      '  - 文件保存在当前工作目录下',
      '',
      '输出格式:',
      '  Markdown 格式：',
      '  - # PY_APP 对话分享（一级标题）',
      '  - > 分享时间（引用块）',
      '  - ## 用户 / ## Claude（二级标题）',
      '  - 支持 text / tool_use / tool_result / thinking 内容块',
      '',
      '  JSON 格式（--json）：',
      '  - 结构化数据，含 app / shareTime / messages',
      '',
      '示例:',
      '  /share',
      '  /share my-chat',
      '  /share discussion.md',
      '  /share status',
      '  /share --json',
      '',
      '别名: /分享',
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
      '分享状态',
      '==============',
      '',
      `对话消息数: ${msgCount}`,
      `工作目录: ${process.cwd()}`,
      `输出格式: Markdown (.md)`,
      `编码: UTF-8`,
      '',
      `可用分享: /share, /share <文件名>, /share --json`,
    ].join('\n'),
  };
}

/**
 * 处理 JSON 分享
 */
async function handleJsonShare(context: CommandContext) {
  const timestamp = formatTimestamp(new Date());
  const jsonFilename = `share-${timestamp}.json`;
  const mdFilename = `share-${timestamp}.md`;

  const mdContent = renderShareContent(context);
  const jsonContent = renderShareJson(context);

  const mdPath = await saveToFile(mdContent, mdFilename);
  const jsonPath = await saveToFile(jsonContent, jsonFilename);

  (await import('@modules/services/analytics/index.js')).logEvent(
    'tengu_share_created',
    {
      format: 'both',
      messageCount: context.messages?.length || 0,
    }
  );

  return {
    success: true,
    message: `对话已分享:\n  Markdown: ${mdPath}\n  JSON: ${jsonPath}`,
  };
}

/**
 * 处理文件分享
 */
async function handleShare(filenameArg: string, context: CommandContext) {
  const content = renderShareContent(context);

  let filepath: string;

  if (filenameArg) {
    const finalFilename = filenameArg.endsWith('.md')
      ? filenameArg
      : filenameArg.replace(/\.[^.]+$/, '') + '.md';
    filepath = await saveToFile(content, finalFilename);
  } else {
    const timestamp = formatTimestamp(new Date());
    const filename = `share-${timestamp}.md`;
    filepath = await saveToFile(content, filename);
  }

  (await import('@modules/services/analytics/index.js')).logEvent(
    'tengu_share_created',
    {
      format: 'markdown',
      messageCount: context.messages?.length || 0,
      hasCustomName: !!filenameArg,
    }
  );

  return {
    success: true,
    message: `对话已分享到: ${filepath}`,
  };
}

export default shareCommand;
