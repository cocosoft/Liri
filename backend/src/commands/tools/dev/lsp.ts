/**
 * LSP命令
 * 调用LSPTool来执行语言服务器协议操作
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '../../../tools/ToolManager.js';

/**
 * LSP命令
 */
export const lspCommand: Command = {
  type: 'action',
  name: 'lsp',
  description: '执行语言服务器协议操作',
  aliases: [],
  argumentHint:
    '[completion|definition|references|hover|help] <file> <line> <col>',
  whenToUse: '当你需要执行语言服务器协议操作时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return {
          success: true,
          message: `LSP Command Help\n=====================\n\nUsage:\n  /lsp completion <file> <line> <col>  - Get code completions\n  /lsp definition <file> <line> <col>  - Find definition\n  /lsp references <file> <line> <col>  - Find references\n  /lsp hover <file> <line> <col>       - Get hover information\n\nExamples:\n  /lsp completion src/index.ts 10 5\n  /lsp definition src/index.ts 5 10`,
        };
      }

      if (
        subcommand === 'completion' ||
        subcommand === 'definition' ||
        subcommand === 'references' ||
        subcommand === 'hover'
      ) {
        const file = parts[1];
        const line = parts[2];
        const col = parts[3];

        if (!file || !line || !col) {
          return {
            success: false,
            error: `Error: Please specify file, line and column\nUsage: /lsp ${subcommand} <file> <line> <col>`,
          };
        }

        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'lsp',
            {
              action: subcommand,
              file: file,
              line: parseInt(line),
              col: parseInt(col),
            },
            {}
          );

          return {
            success: true,
            message: JSON.stringify(result, null, 2),
          };
        } catch (error) {
          return {
            success: false,
            error: `Error executing LSP ${subcommand}: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      return {
        success: false,
        error: `Error: Unknown subcommand: ${subcommand}\n\nUse /lsp help for help`,
      };
    },
  }),
};

export default lspCommand;
