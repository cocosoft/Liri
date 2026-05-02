/**
 * 工具命令
 * 管理工具
 */
import type { Command } from '../../types/index.js';

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
      // 模拟工具列表
      const tools = [
        { name: 'terminal', description: '终端工具', enabled: true },
        { name: 'file', description: '文件工具', enabled: true },
        { name: 'web', description: '网页工具', enabled: false },
        { name: 'code', description: '代码工具', enabled: true },
      ];

      const parts = args.split(/\s+/);
      const subcommand = parts[0];
      const restArgs = parts.slice(1).join(' ');

      switch (subcommand) {
        case 'list':
          const toolList = tools
            .map(
              (tool) =>
                `  ${tool.name} - ${tool.description} (${tool.enabled ? 'enabled' : 'disabled'})`
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
            toolToEnable.enabled = true;
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
            toolToDisable.enabled = false;
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

export default toolCommand;
