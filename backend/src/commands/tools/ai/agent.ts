/**
 * Agent命令
 * 调用AgentTool来执行Agent任务
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '../../../tools/ToolManager.js';

/**
 * Agent命令
 */
export const agentCommand: Command = {
  type: 'action',
  name: 'agent',
  description: '执行Agent任务',
  aliases: [],
  argumentHint: '<agent_type> <task>',
  whenToUse: '当你需要执行复杂的Agent任务时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);

      if (parts.length < 2) {
        return {
          success: false,
          error: `Usage: /agent <agent_type> <task>\n\nCreate and run an agent to complete a task.\n\nExample:\n  /agent general "Write a simple Python script"\n  /agent code "Fix this bug: ..."`,
        };
      }

      const agentType = parts[0];
      const task = parts.slice(1).join(' ');

      try {
        const toolManager = getToolManager();
        const result = await toolManager.executeTool(
          'Agent',
          {
            agent_type: agentType,
            task: task,
          },
          {}
        );

        return {
          success: true,
          message: result.output || 'Agent task completed',
        };
      } catch (error) {
        return {
          success: false,
          error: `Error running agent: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  }),
};

export default agentCommand;
