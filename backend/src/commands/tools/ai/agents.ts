/**
 * Agents命令
 * 管理多个Agent实例
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '../../../tools/ToolManager.js';

/**
 * Agents命令
 */
export const agentsCommand: Command = {
  type: 'action',
  name: 'agents',
  description: '管理多个Agent实例',
  aliases: [],
  argumentHint: '[list|create|delete|help] [args]',
  whenToUse: '当你需要管理多个Agent实例时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return {
          success: true,
          message: `Agents Command Help\n=====================\n\nUsage:\n  /agents list                    - List all active agents\n  /agents create <type> <name>    - Create a new agent\n  /agents delete <agent_id>       - Delete an agent\n\nExamples:\n  /agents list\n  /agents create general my_agent\n  /agents delete 12345`,
        };
      }

      if (subcommand === 'list') {
        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'Agent',
            {
              action: 'list',
            },
            {}
          );

          if (result.agents && result.agents.length > 0) {
            return {
              success: true,
              message: `Active Agents:\n${result.agents.map((agent: any) => `  ${agent.id}: ${agent.name} (${agent.type})`).join('\n')}`,
            };
          } else {
            return {
              success: true,
              message: 'No active agents',
            };
          }
        } catch (error) {
          return {
            success: false,
            error: `Error listing agents: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      if (subcommand === 'create') {
        const agentType = parts[1];
        const agentName = parts[2];

        if (!agentType || !agentName) {
          return {
            success: false,
            error:
              'Error: Please specify agent type and name\nUsage: /agents create <type> <name>',
          };
        }

        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'Agent',
            {
              action: 'create',
              agent_type: agentType,
              name: agentName,
            },
            {}
          );

          return {
            success: true,
            message: `Agent created: ${result.agent_id}`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error creating agent: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      if (subcommand === 'delete') {
        const agentId = parts[1];

        if (!agentId) {
          return {
            success: false,
            error:
              'Error: Please specify agent ID\nUsage: /agents delete <agent_id>',
          };
        }

        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'Agent',
            {
              action: 'delete',
              agent_id: agentId,
            },
            {}
          );

          return {
            success: true,
            message: `Agent deleted: ${agentId}`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error deleting agent: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      return {
        success: false,
        error: `Error: Unknown subcommand: ${subcommand}\n\nUse /agents help for help`,
      };
    },
  }),
};

export default agentsCommand;
