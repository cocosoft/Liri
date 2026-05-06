/**
 * 文件匹配命令
 * 调用GlobTool来匹配文件
 */

import type { Command } from '@modules/commands/types';
import { getToolManager } from '@modules/tools/ToolManager.js';

/**
 * 匹配文件命令
 */
export const globCommand: Command = {
  type: 'action',
  name: 'glob',
  description: '匹配文件路径',
  aliases: [],
  argumentHint: '<pattern>',
  whenToUse: '当你需要匹配文件路径时',
  load: async () => ({
    execute: async (args: string) => {
      const pattern = args.trim();

      if (!pattern) {
        return {
          success: false,
          error: `Usage: /glob <pattern>\n\nFind files matching a glob pattern.\n\nExample:\n  /glob *.ts\n  /glob src/**/*.js`,
        };
      }

      try {
        const toolManager = getToolManager();
        const result = await toolManager.executeTool(
          'glob',
          {
            pattern: pattern,
          },
          {}
        );

        if (result.data && Array.isArray(result.data) && result.data.length > 0) {
          return {
            success: true,
            message: `Found ${result.data.length} files:\n${result.data.join('\n')}`,
          };
        } else {
          return {
            success: true,
            message: `No files found matching pattern: ${pattern}`,
          };
        }
      } catch (error) {
        return {
          success: false,
          error: `Error finding files: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  }),
};

export default globCommand;
