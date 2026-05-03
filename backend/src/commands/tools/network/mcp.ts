/**
 * MCP Tool命令
 * 调用MCPTool来执行MCP操作
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '../../../tools/ToolManager.js';

/**
 * MCP Tool命令
 */
export const mcpToolCommand: Command = {
  type: 'action',
  name: 'mcp-tool',
  description: '执行MCP操作（通过ToolManager）',
  aliases: [],
  argumentHint: '<action> <params>',
  whenToUse: '当你需要执行MCP操作时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);

      if (parts.length < 2) {
        return {
          success: false,
          error: `Usage: /mcp <action> <params>\n\nExecute MCP (Model Context Protocol) operations.\n\nExample:\n  /mcp get_context\n  /mcp set_context "Hello, world!"`,
        };
      }

      const action = parts[0];
      const params = parts.slice(1).join(' ');

      try {
        const toolManager = getToolManager();
        const result = await toolManager.executeTool(
          'mcp',
          {
            action: action,
            params: params,
          },
          {}
        );

        return {
          success: true,
          message: result.output || 'MCP operation completed',
        };
      } catch (error) {
        return {
          success: false,
          error: `Error executing MCP operation: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  }),
};

export default mcpToolCommand;
