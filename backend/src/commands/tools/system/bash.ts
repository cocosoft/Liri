/**
 * Bash命令
 * 调用BashTool来执行bash命令
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '../../../tools/ToolManager.js';

/**
 * Bash命令
 */
export const bashCommand: Command = {
  type: 'action',
  name: 'bash',
  description: '执行bash命令',
  aliases: [],
  argumentHint: '<command>',
  whenToUse: '当你需要执行bash命令时',
  load: async () => ({
    execute: async (args: string) => {
      const command = args.trim();

      if (!command) {
        return {
          success: false,
          error: `Usage: /bash <command>\n\nExecute a bash command.\n\nExample:\n  /bash ls -la`,
        };
      }

      try {
        const toolManager = getToolManager();
        const result = await toolManager.executeTool(
          'BashTool',
          {
            command: command,
          },
          {}
        );

        return {
          success: true,
          message: result.output || 'Command executed successfully',
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
