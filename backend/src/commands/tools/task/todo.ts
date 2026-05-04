/**
 * Todo命令
 * 调用TodoWriteTool来管理待办事项
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '../../../tools/ToolManager.js';

/**
 * Todo命令
 */
export const todoCommand: Command = {
  type: 'action',
  name: 'todo',
  description: '管理待办事项',
  aliases: [],
  argumentHint: '[add|list|update|delete|help] [args]',
  whenToUse: '当你需要管理待办事项时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return {
          success: true,
          message: `Todo Command Help\n=====================\n\nUsage:\n  /todo add <task>                - Add a new todo item\n  /todo list                      - List all todo items\n  /todo update <id> <status>      - Update todo status\n  /todo delete <id>               - Delete a todo item\n\nExamples:\n  /todo add "Complete project"\n  /todo list\n  /todo update 1 completed\n  /todo delete 1`,
        };
      }

      if (subcommand === 'add') {
        const task = parts.slice(1).join(' ');

        if (!task) {
          return {
            success: false,
            error:
              'Error: Please specify task content\nUsage: /todo add <task>',
          };
        }

        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'todo_write',
            {
              action: 'add',
              content: task,
              status: 'pending',
              priority: 'medium',
            },
            {}
          );

          return {
            success: true,
            message: `Todo added successfully`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error adding todo: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      if (subcommand === 'list') {
        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'todo_write',
            {
              action: 'list',
            },
            {}
          );

          if (result.todos && result.todos.length > 0) {
            const formattedTodos = result.todos
              .map((todo: any) => {
                return `[${todo.id}] ${todo.content} (${todo.status}, ${todo.priority})`;
              })
              .join('\n');

            return {
              success: true,
              message: `Todo List:\n${formattedTodos}`,
            };
          } else {
            return {
              success: true,
              message: 'No todo items found',
            };
          }
        } catch (error) {
          return {
            success: false,
            error: `Error listing todos: ${error instanceof Error ? error.message : String(error)}`,
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
              'Error: Please specify todo ID and status\nUsage: /todo update <id> <status>',
          };
        }

        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'todo_write',
            {
              action: 'update',
              id: id,
              status: status,
            },
            {}
          );

          return {
            success: true,
            message: `Todo updated successfully`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error updating todo: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      if (subcommand === 'delete') {
        const id = parts[1];

        if (!id) {
          return {
            success: false,
            error: 'Error: Please specify todo ID\nUsage: /todo delete <id>',
          };
        }

        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'todo_write',
            {
              action: 'delete',
              id: id,
            },
            {}
          );

          return {
            success: true,
            message: `Todo deleted successfully`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error deleting todo: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      return {
        success: false,
        error: `Error: Unknown subcommand: ${subcommand}\n\nUse /todo help for help`,
      };
    },
  }),
};


