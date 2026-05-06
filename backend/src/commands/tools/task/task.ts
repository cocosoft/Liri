/**
 * Task命令
 * 调用TaskTool系列来管理任务
 * 基于CC源码 cc_code/backend/tools/TaskTool 实现
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '@modules/tools/ToolManager.js';
import { defaultTaskStorage } from '@modules/tools/TaskTool/TaskStorage.js';

/**
 * Task命令
 */
export const taskCommand: Command = {
  type: 'action',
  name: 'task',
  description: '管理任务',
  aliases: [],
  argumentHint: '[create|list|get|update|delete|help] [args]',
  whenToUse: '当你需要管理任务时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return {
          success: true,
          message: `Task Command Help
=====================

Usage:
  /task create <subject> <description>     - 创建任务
  /task list [pending|in_progress|completed|failed|cancelled] - 列出任务
  /task get <id>                           - 获取任务详情
  /task update <id> <status> [subject] [desc] - 更新任务
  /task delete <id>                        - 删除任务

Status:
  pending      - 待处理
  in_progress  - 进行中
  completed    - 已完成
  failed       - 失败
  cancelled    - 已取消

Examples:
  /task create "Project" "Complete the project"
  /task list
  /task list pending
  /task get task_xxx
  /task update task_xxx completed
  /task update task_xxx in_progress
  /task delete task_xxx`,
        };
      }

      if (subcommand === 'create') {
        const subject = parts[1];
        const description = parts.slice(2).join(' ');

        if (!subject || !description) {
          return {
            success: false,
            error:
              'Error: Please specify subject and description\nUsage: /task create <subject> <description>',
          };
        }

        try {
          const toolManager = getToolManager();
          const rawResult = await toolManager.executeTool(
            'TaskCreate',
            {
              subject: subject,
              description: description,
            },
            {}
          );

          // TaskCreateTool 返回 JSON.stringify({ task: { id, subject } })
          const data = JSON.parse(rawResult.data as string) as { task: { id: string; subject: string } };

          return {
            success: true,
            message: `Task created successfully:\n  ID: ${data.task.id}\n  Subject: ${data.task.subject}`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error creating task: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      if (subcommand === 'list') {
        const statusFilter = parts[1];

        try {
          const toolManager = getToolManager();
          const rawResult = await toolManager.executeTool('TaskList', {}, {});

          // TaskListTool 返回 JSON.stringify({ tasks: [...] })
          const data = JSON.parse(rawResult.data as string) as { tasks: Array<{ id: string; subject: string; status: string; owner?: string }> };

          let tasks = data.tasks || [];

          if (statusFilter) {
            tasks = tasks.filter((t) => t.status === statusFilter);
          }

          if (tasks.length > 0) {
            const formattedTasks = tasks
              .map((task) => {
                const statusIcon =
                  task.status === 'completed' ? '✓' :
                  task.status === 'failed' ? '✗' :
                  task.status === 'in_progress' ? '▶' :
                  task.status === 'cancelled' ? '■' : '○';
                return `${tasks.indexOf(task) + 1}. [${statusIcon}] ${task.subject}\n   ID: ${task.id} | Status: ${task.status}`;
              })
              .join('\n\n');

            return {
              success: true,
              message: `Task List (${tasks.length}):\n\n${formattedTasks}`,
            };
          } else {
            return {
              success: true,
              message: statusFilter
                ? `No tasks with status: ${statusFilter}`
                : 'No tasks found',
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
          const rawResult = await toolManager.executeTool(
            'TaskGet',
            {
              id: id,
            },
            {}
          );

          // TaskGetTool 返回 JSON.stringify({ id, subject, status, description, ... })
          const data = JSON.parse(rawResult.data as string) as {
            id: string;
            subject: string;
            status: string;
            description?: string;
            priority?: string;
            owner?: string;
            activeForm?: string;
            blockedBy?: string[];
            createdAt?: number;
            updatedAt?: number;
          };

          if (data && data.id) {
            return {
              success: true,
              message: `Task Details:
  ID: ${data.id}
  Subject: ${data.subject}
  Status: ${data.status}
  Description: ${data.description || 'N/A'}
  Priority: ${data.priority || 'medium'}
  Owner: ${data.owner || 'N/A'}
  Active Form: ${data.activeForm || 'N/A'}
  Blocked By: ${data.blockedBy?.length ? data.blockedBy.join(', ') : 'None'}
  Created: ${data.createdAt ? new Date(data.createdAt).toLocaleString() : 'N/A'}
  Updated: ${data.updatedAt ? new Date(data.updatedAt).toLocaleString() : 'N/A'}`,
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
        const subject = parts[3];
        const description = parts.slice(4).join(' ');

        if (!id || !status) {
          return {
            success: false,
            error:
              'Error: Please specify task ID and status\nUsage: /task update <id> <status> [subject] [description]',
          };
        }

        try {
          const toolManager = getToolManager();
          const updateInput: Record<string, unknown> = {
            id: id,
            status: status,
          };

          if (subject) {
            updateInput.subject = subject;
          }
          if (description) {
            updateInput.description = description;
          }

          const rawResult = await toolManager.executeTool(
            'TaskUpdate',
            updateInput,
            {}
          );

          // TaskUpdateTool 返回 JSON.stringify({ task: { id, subject, status } })
          const data = JSON.parse(rawResult.data as string) as { task: { id: string; subject: string; status: string } };

          if (data && data.task) {
            return {
              success: true,
              message: `Task updated successfully:\n  ID: ${data.task.id}\n  Subject: ${data.task.subject}\n  Status: ${data.task.status}`,
            };
          }

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

      if (subcommand === 'delete') {
        const id = parts[1];

        if (!id) {
          return {
            success: false,
            error: 'Error: Please specify task ID\nUsage: /task delete <id>',
          };
        }

        try {
          await defaultTaskStorage.delete(id);

          return {
            success: true,
            message: `Task deleted successfully: ${id}`,
          };
        } catch (error) {
          return {
            success: false,
            error: `Error deleting task: ${error instanceof Error ? error.message : String(error)}`,
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

export default taskCommand;


