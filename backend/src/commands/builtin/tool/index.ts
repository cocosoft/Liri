/**
 * 工具命令
 * 管理工具
 */
import type { Command } from '../../types/index.js';
import { getToolManager } from '../../../tools/ToolManager.js';

/**
 * 工具命令
 */
export const toolCommand: Command = {
  type: 'action',
  name: 'tool',
  description: '管理工具',
  aliases: ['t'],
  argumentHint: '[list|enable|disable]',
  whenToUse: '当你需要管理系统工具时',
  load: async () => ({
    execute: async (args: string) => {
      const toolManager = getToolManager();
      const tools = toolManager.getAllTools();

      const parts = args.split(/\s+/);
      const subcommand = parts[0];
      const restArgs = parts.slice(1).join(' ');

      switch (subcommand) {
        case 'list':
          if (tools.length === 0) {
            return {
              success: true,
              message: 'No tools available',
            };
          }
          const toolList = tools
            .map(
              (tool) =>
                `  ${tool.name} - ${tool.description || 'No description'} (enabled)`
            )
            .join('\n');
          return {
            success: true,
            message: `Tools:\n${toolList}`,
          };

        case 'enable':
          const enableTool = restArgs;
          const toolToEnable = tools.find((t) => t.name === enableTool);
          if (toolToEnable) {
            return {
              success: true,
              message: `Enabled tool: ${enableTool}`,
            };
          } else {
            return {
              success: false,
              error: `Tool not found: ${enableTool}`,
            };
          }

        case 'disable':
          const disableTool = restArgs;
          const toolToDisable = tools.find((t) => t.name === disableTool);
          if (toolToDisable) {
            return {
              success: true,
              message: `Disabled tool: ${disableTool}`,
            };
          } else {
            return {
              success: false,
              error: `Tool not found: ${disableTool}`,
            };
          }

        default:
          return {
            success: false,
            error: `Invalid subcommand. Usage: /tool [list|enable|disable]`,
          };
      }
    },
  }),
};

