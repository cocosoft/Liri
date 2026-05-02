/**
 * 文件编辑命令
 * 调用FileEditTool来编辑文件
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '../../../tools/ToolManager.js';

/**
 * 编辑文件命令
 */
export const editCommand: Command = {
  type: 'action',
  name: 'edit',
  description: '编辑文件内容',
  aliases: [],
  argumentHint: '<file_path> <old_string> <new_string>',
  whenToUse: '当你需要编辑文件内容时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);

      if (parts.length < 3) {
        return {
          success: false,
          error: `Usage: /edit <file_path> <old_string> <new_string>\n\nEdit a file by replacing old_string with new_string.\n\nExample:\n  /edit test.txt Hello Hi`,
        };
      }

      const filePath = parts[0];
      const oldString = parts[1];
      const newString = parts.slice(2).join(' ');

      try {
        const toolManager = getToolManager();
        const result = await toolManager.executeTool(
          'FileEditTool',
          {
            file_path: filePath,
            old_string: oldString,
            new_string: newString,
          },
          {}
        );

        return {
          success: true,
          message: `Successfully edited ${filePath}`,
        };
      } catch (error) {
        return {
          success: false,
          error: `Error editing file: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  }),
};

export default editCommand;
