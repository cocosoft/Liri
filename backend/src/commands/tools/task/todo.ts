/**
 * Todo命令
 * 调用TodoWriteTool来管理待办事项
 * 基于CC源码 cc_code/backend/tools/TodoWriteTool 实现
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
  argumentHint: '[add|list|update|delete|clear-completed|help] [args]',
  whenToUse: '当你需要管理待办事项时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return {
          success: true,
          message: `Todo Command Help
=====================

Usage:
  /todo add <content>                      - 添加待办事项
  /todo list [pending|in_progress|completed] - 列出待办事项
  /todo update <id> <status> [content]     - 更新待办状态或内容
  /todo delete <id>                        - 删除待办事项
  /todo clear-completed                    - 清除所有已完成事项

Status:
  pending      - 待处理
  in_progress  - 进行中
  completed    - 已完成

Examples:
  /todo add "Complete project"
  /todo list
  /todo list pending
  /todo update todo_xxx completed
  /todo update todo_xxx in_progress
  /todo delete todo_xxx
  /todo clear-completed`,
        };
      }

      if (subcommand === 'add') {
        const content = parts.slice(1).join(' ');

        if (!content) {
          return {
            success: false,
            error:
              'Error: Please specify task content\nUsage: /todo add <content>',
          };
        }

        try {
          const toolManager = getToolManager();
          const rawResult = await toolManager.executeTool(
            'todo_write',
            {
              action: 'add',
              content: content,
            },
            {}
          );

          if (rawResult.success && rawResult.data) {
            return {
              success: true,
              message: rawResult.data as string,
            };
          }

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
        const statusFilter = parts[1];

        try {
          const toolManager = getToolManager();
          const rawResult = await toolManager.executeTool(
            'todo_write',
            {
              action: 'list',
            },
            {}
          );

          // TodoWriteTool 返回的数据在 data 字段中，为格式化后的字符串
          const output = rawResult.data as string;

          if (output && typeof output === 'string' && !output.startsWith('No todos')) {
            if (statusFilter) {
              // 过滤特定状态的行
              const lines = output.split('\n');
              const filteredLines: string[] = [];

              for (const line of lines) {
                if (line.startsWith('Todo List') ||
                    line.startsWith('  Pending') ||
                    line.startsWith('=') ||
                    line.trim() === '' ||
                    line.includes(`Status: ${statusFilter}`)) {
                  filteredLines.push(line);
                }
              }

              return {
                success: true,
                message: `${filteredLines.join('\n')}`,
              };
            }

            return {
              success: true,
              message: `${output}`,
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
        const todoId = parts[1];
        const status = parts[2];
        const content = parts.slice(3).join(' ');

        if (!todoId || !status) {
          return {
            success: false,
            error:
              'Error: Please specify todo ID and status\nUsage: /todo update <id> <status> [content]',
          };
        }

        try {
          const toolManager = getToolManager();
          const rawResult = await toolManager.executeTool(
            'todo_write',
            {
              action: 'update',
              todo_id: todoId,
              status: status,
              ...(content ? { content } : {}),
            },
            {}
          );

          if (rawResult.success && rawResult.data) {
            return {
              success: true,
              message: rawResult.data as string,
            };
          }

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
        const todoId = parts[1];

        if (!todoId) {
          return {
            success: false,
            error: 'Error: Please specify todo ID\nUsage: /todo delete <id>',
          };
        }

        try {
          const toolManager = getToolManager();
          const rawResult = await toolManager.executeTool(
            'todo_write',
            {
              action: 'delete',
              todo_id: todoId,
            },
            {}
          );

          if (rawResult.success && rawResult.data) {
            return {
              success: true,
              message: rawResult.data as string,
            };
          }

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

      // 清除已完成: clear-completed, clear_completed, clear
      if (subcommand === 'clear-completed' || subcommand === 'clear_completed' || subcommand === 'clear') {
        try {
          const toolManager = getToolManager();
          const rawResult = await toolManager.executeTool(
            'todo_write',
            {
              action: 'clear_completed',
            },
            {}
          );

          if (rawResult.success && rawResult.data) {
            return {
              success: true,
              message: rawResult.data as string,
            };
          }

          return {
            success: true,
            message: `Completed todos cleared`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error clearing completed todos: ${error instanceof Error ? error.message : String(error)}`,
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

export default todoCommand;


