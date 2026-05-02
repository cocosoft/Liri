/**
 * Grep命令
 * 调用GrepTool来搜索文本
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '../../../tools/ToolManager.js';

/**
 * Grep命令
 */
export const grepCommand: Command = {
  type: 'action',
  name: 'grep',
  description: '搜索文本',
  aliases: [],
  argumentHint: '<pattern> <path>',
  whenToUse: '当你需要搜索文本时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);

      if (parts.length < 2) {
        return {
          success: false,
          error: `Usage: /grep <pattern> <path>\n\nSearch text in files.\n\nExample:\n  /grep function src/\n  /grep "class" *.ts`,
        };
      }

      const pattern = parts[0];
      const path = parts.slice(1).join(' ');

      try {
        const toolManager = getToolManager();
        const result = await toolManager.executeTool(
          'grep',
          {
            pattern: pattern,
            path: path,
          },
          {}
        );

        if (result.matches && result.matches.length > 0) {
          return {
            success: true,
            message: result.matches.join('\n'),
          };
        } else {
          return {
            success: true,
            message: `No matches found for pattern: ${pattern}`,
          };
        }
      } catch (error) {
        return {
          success: false,
          error: `Error searching text: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  }),
};

export default grepCommand;
