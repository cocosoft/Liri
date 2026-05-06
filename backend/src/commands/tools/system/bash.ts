/**
 * Bash命令
 * 对标CC源码实现，支持超时、工作目录等高级参数
 */

import type { Command } from '@modules/commands/types';
import { getToolManager } from '@modules/tools/ToolManager.js';

/**
 * 解析命令行参数，提取 --timeout 和 --cwd 选项
 * @param args 原始参数字符串
 * @returns 解析后的选项和执行命令
 */
function parseBashArgs(args: string): {
  command: string;
  timeout?: number;
  cwd?: string;
} {
  let timeout: number | undefined;
  let cwd: string | undefined;
  const tokens: string[] = [];
  let i = 0;

  const parts = args.trim().split(/\s+/);
  while (i < parts.length) {
    const part = parts[i];
    if (part === '--timeout' && i + 1 < parts.length) {
      const val = parseInt(parts[i + 1], 10);
      if (!isNaN(val) && val > 0) {
        timeout = Math.min(val, 300000);
      }
      i += 2;
    } else if (part === '--cwd' && i + 1 < parts.length) {
      cwd = parts[i + 1];
      i += 2;
    } else {
      tokens.push(part);
      i++;
    }
  }

  return {
    command: tokens.join(' '),
    timeout,
    cwd,
  };
}

/**
 * Bash命令
 */
export const bashCommand: Command = {
  type: 'action',
  name: 'bash',
  description: '执行bash命令',
  aliases: ['sh', 'shell'],
  argumentHint: '[--timeout <ms>] [--cwd <path>] <command>',
  whenToUse: '当你需要执行bash命令时',
  load: async () => ({
    execute: async (args: string) => {
      if (!args.trim()) {
        return {
          success: false,
          error: [
            '用法: /bash [选项] <command>',
            '',
            '执行bash命令，支持安全检查和参数选项。',
            '',
            '选项:',
            '  --timeout <ms>    执行超时时间（毫秒，默认60000，最大300000）',
            '  --cwd <path>      指定工作目录（默认当前目录）',
            '',
            '示例:',
            '  /bash ls -la',
            '  /bash --timeout 10000 npm install',
            '  /bash --cwd /home/project git status',
          ].join('\n'),
        };
      }

      const { command, timeout, cwd } = parseBashArgs(args);

      if (!command) {
        return {
          success: false,
          error: '错误: 未指定要执行的命令',
        };
      }

      try {
        const toolManager = getToolManager();
        const toolInput: Record<string, unknown> = { command };

        if (timeout !== undefined) {
          toolInput.timeout = timeout;
        }
        if (cwd !== undefined) {
          toolInput.cwd = cwd;
        }

        const result = await toolManager.executeTool(
          'bash',
          toolInput,
          {}
        );

        const messageParts: string[] = [];

        if (result.data && typeof result.data === 'string') {
          messageParts.push(result.data);
        }

        if (result.output) {
          messageParts.push(result.output);
        }

        if (result.errorOutput) {
          messageParts.push(`[stderr]\n${result.errorOutput}`);
        }

        const message = messageParts.join('\n') || 'Command executed successfully';

        return {
          success: true,
          message,
        };
      } catch (error) {
        return {
          success: false,
          error: `Error executing bash command: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  }),
};

export default bashCommand;
