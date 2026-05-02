/**
 * REPL命令
 * 调用REPLTool来执行交互式代码
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '../../../tools/ToolManager.js';

/**
 * REPL命令
 */
export const replCommand: Command = {
  type: 'action',
  name: 'repl',
  description: '执行交互式代码',
  aliases: [],
  argumentHint: '<language> <code>',
  whenToUse: '当你需要执行交互式代码时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const language = parts[0];
      const code = parts.slice(1).join(' ');

      if (!language || !code) {
        return {
          success: false,
          error: `Usage: /repl <language> <code>\n\nExecute code in a REPL environment.\n\nExample:\n  /repl python "print('Hello, world!')"\n  /repl javascript "console.log('Hello, world!')"`,
        };
      }

      try {
        const toolManager = getToolManager();
        const result = await toolManager.executeTool(
          'repl',
          {
            language: language,
            code: code,
          },
          {}
        );

        return {
          success: true,
          message: result.output || 'Code executed successfully',
        };
      } catch (error) {
        return {
          success: false,
          error: `Error executing code: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  }),
};

export default replCommand;
