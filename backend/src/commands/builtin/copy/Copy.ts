// @ts-nocheck
/**
 * Copy命令
 * 将响应复制到剪贴板
 */

import type { CommandContext } from '../../types/index.js';
import clipboardy from 'clipboardy';

interface CopyOptions {
  maxLines?: number;
  includeMetadata?: boolean;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await clipboardy.write(text);
    return true;
  } catch (error) {
    console.error('复制到剪贴板失败:', error);
    return false;
  }
}

function truncateText(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return text;
  }
  return lines.slice(0, maxLines).join('\n') + '\n... (truncated)';
}

const copyCommand = {
  async call(args: string, context: CommandContext): Promise<{ type: string; value: string }> {
    const params = args.trim().split(' ');
    const options: CopyOptions = {
      maxLines: 100,
      includeMetadata: false,
    };

    let textToCopy = '';
    let copySuccess = false;

    for (const param of params) {
      if (param.startsWith('--lines=')) {
        options.maxLines = parseInt(param.replace('--lines=', ''), 10);
      } else if (param === '--meta' || param === '-m') {
        options.includeMetadata = true;
      }
    }

    if (context.messages && context.messages.length > 0) {
      const recentMessages = context.messages.slice(-10);
      const assistantTexts: string[] = [];

      for (const msg of recentMessages) {
        if (msg.role === 'assistant' && 'message' in msg) {
          const content = msg.message?.content;
          if (typeof content === 'string') {
            assistantTexts.push(content);
          } else if (Array.isArray(content)) {
            const textContent = content
              .filter((block) => block.type === 'text')
              .map((block) => ('text' in block ? block.text : ''))
              .join('\n');
            if (textContent) {
              assistantTexts.push(textContent);
            }
          }
        }
      }

      if (assistantTexts.length > 0) {
        textToCopy = assistantTexts.join('\n\n---\n\n');
      }
    }

    if (!textToCopy) {
      return {
        type: 'text',
        value: '没有可复制的内容',
      };
    }

    if (options.maxLines && options.maxLines > 0) {
      textToCopy = truncateText(textToCopy, options.maxLines);
    }

    copySuccess = await copyToClipboard(textToCopy);

    if (copySuccess) {
      return {
        type: 'text',
        value: '已复制到剪贴板',
      };
    }

    return {
      type: 'text',
      value: '复制到剪贴板失败，但内容如下:\n\n' + textToCopy,
    };
  },
};

export default copyCommand;
