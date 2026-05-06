/**
 * 文件写入命令
 * 调用FileWriteTool来写入文件
 */

import type { Command } from '@modules/commands/types';
import { getToolManager } from '@modules/tools/ToolManager.js';

/**
 * 写入文件命令
 */
export const writeCommand: Command = {
  type: 'action',
  name: 'write',
  description: '写入内容到文件',
  aliases: [],
  argumentHint: '<file_path> <content>',
  whenToUse: '当你需要写入内容到文件时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);

      if (parts.length < 2) {
        return {
          success: false,
          error: `Usage: /write <file_path> <content>\n\nWrite content to a file.\n\nExample:\n  /write test.txt Hello, world!`,
        };
      }

      const filePath = parts[0];
      const content = parts.slice(1).join(' ');

      try {
        const toolManager = getToolManager();
        const result = await toolManager.executeTool(
          'file_write',
          {
            file_path: filePath,
            content: content,
          },
          {}
        );

        return {
          success: true,
          message: `Successfully wrote to ${filePath}`,
        };
      } catch (error) {
        return {
          success: false,
          error: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  }),
};

export default writeCommand;
