/**
 * Task命令
 * 调用TaskTool系列来管理任务
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '../../../tools/ToolManager.js';

/**
 * Task命令
 */
export const taskCommand: Command = {
  type: 'action',
  name: 'task',
  description: '管理任务',
  aliases: [],
  argumentHint: '[create|list|get|update|help] [args]',
  whenToUse: '当你需要管理任务时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return {
          success: true,
          message: `Task Command Help\n=====================\n\nUsage:\n  /task create <title> <description>  - Create a new task\n  /task list                          - List all tasks\n  /task get <id>                      - Get task details\n  /task update <id> <status>          - Update task status\n\nExamples:\n  /task create "Project" "Complete the project"\n  /task list\n  /task get 1\n  /task update 1 completed`,
        };
      }

      if (subcommand === 'create') {
        const title = parts[1];
        const description = parts.slice(2).join(' ');

        if (!title || !description) {
          return {
            success: false,
            error:
              'Error: Please specify title and description\nUsage: /task create <title> <description>',
          };
        }

        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'TaskCreate',
            {
              title: title,
              description: description,
              status: 'pending',
              priority: 'medium',
            },
            {}
          );

          return {
            success: true,
            message: `Task created successfully: ${result.task_id}`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error creating task: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      if (subcommand === 'list') {
        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool('TaskList', {}, {});

          if (result.tasks && result.tasks.length > 0) {
            const formattedTasks = result.tasks
              .map((task: any) => {
                return `[${task.id}] ${task.title} (${task.status}, ${task.priority})`;
              })
              .join('\n');

            return {
              success: true,
              message: `Task List:\n${formattedTasks}`,
            };
          } else {
            return {
              success: true,
              message: 'No tasks found',
            };
          }
        } catch (error) {
          return {
            success: false,
            error: `Error listing tasks: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      if (subcommand === 'get') {
        const id = parts[1];

        if (!id) {
          return {
            success: false,
            error: 'Error: Please specify task ID\nUsage: /task get <id>',
          };
        }

        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'TaskGet',
            {
              task_id: id,
            },
            {}
          );

          if (result.task) {
            const task = result.task;
            return {
              success: true,
              message: `Task Details:\nID: ${task.id}\nTitle: ${task.title}\nDescription: ${task.description}\nStatus: ${task.status}\nPriority: ${task.priority}\nCreated: ${task.created_at}`,
            };
          } else {
            return {
              success: false,
              error: `Task not found: ${id}`,
            };
          }
        } catch (error) {
          return {
            success: false,
            error: `Error getting task: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      if (subcommand === 'update') {
        const id = parts[1];
        const status = parts[2];

        if (!id || !status) {
          return {
            success: false,
            error:
              'Error: Please specify task ID and status\nUsage: /task update <id> <status>',
          };
        }

        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'TaskUpdate',
            {
              task_id: id,
              status: status,
            },
            {}
          );

          return {
            success: true,
            message: `Task updated successfully`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error updating task: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      return {
        success: false,
        error: `Error: Unknown subcommand: ${subcommand}\n\nUse /task help for help`,
      };
    },
  }),
};


