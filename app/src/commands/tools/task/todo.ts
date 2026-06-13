/**
 * Todo命令
 * 调用TodoWriteTool来管理待办事项
 * * CC 的 TodoWriteTool 采用 replace-all 模式（每次传入完整 todo 列表替换整个状态），
 * 并支持 activeForm（现在进行时）字段和验证代理提示。
 * 本命令层提供人性化的 CRUD 接口，同时保持与 CC 工具的兼容。
 */

import type { Command, CommandResult } from '@modules/commands/types';
import { getToolManager } from '@modules/tools/ToolManager.js';

/** 有效的 todo 状态 */
const VALID_STATUSES = ['pending', 'in_progress', 'completed'] as const;
type TodoStatus = (typeof VALID_STATUSES)[number];

/** 解析 --json 标志 */
function hasJsonFlag(parts: string[]): boolean {
  return parts.includes('--json') || parts.includes('-j');
}

/** 去除 flags 后的参数列表 */
function stripFlags(parts: string[]): string[] {
  return parts.filter((p) => !p.startsWith('--') && !p.startsWith('-'));
}

/**
 * 获取模型提示词（供 AI 理解命令能力）
 */
function getPromptForCommand(): string {
  return [
    '- Todo: 管理待办事项',
    '  - 添加: /todo add <content> [--activeForm <form>]',
    '  - 列出: /todo list [status] [--json]',
    '  - 统计: /todo stats [--json]',
    '  - 更新: /todo update <id> <status> [content] [--activeForm <form>]',
    '  - 删除: /todo delete <id>',
    '  - 清除: /todo clear-completed',
    '  - 写入: /todo write <content1> | <content2> | ...',
    '  - 帮助: /todo help',
  ].join('\n');
}

/**
 * 显示帮助信息
 */
function showHelp(): CommandResult {
  return {
    success: true,
    message: [
      'Todo 命令帮助',
      '=====================',
      '',
      '管理待办事项列表，跟踪任务进度。支持添加、查看、更新、删除和批量写入操作。',
      '',
      '用法:',
      '  /todo add <content> [--activeForm <form>]       添加待办事项',
      '  /todo list [pending|in_progress|completed] [--json]  列出待办事项',
      '  /todo stats [--json]                             显示统计摘要',
      '  /todo update <id> <status> [content]             更新待办状态或内容',
      '  /todo delete <id>                                删除待办事项',
      '  /todo clear-completed                            清除所有已完成事项',
      '  /todo write <content1> | <content2> | ...       批量写入待办事项（覆盖当前列表）',
      '  /todo help                                       显示此帮助',
      '',
      '状态:',
      '  pending      待处理 — 任务尚未开始',
      '  in_progress  进行中 — 正在处理（建议同一时间只设置一个为进行中）',
      '  completed    已完成 — 任务已全部完成',
      '',
      '选项:',
      '  --json, -j                   以 JSON 格式输出（适用于 list 和 stats）',
      '  --activeForm <form>          指定现在进行时描述（如 "正在修复bug"）',
      '',
      '示例:',
      '  /todo add "Complete project"                                           添加任务',
      '  /todo add "Fix bug" --activeForm "Fixing the login bug"                添加任务并指定 activeForm',
      '  /todo list                                                             列出所有任务',
      '  /todo list pending                                                     列出待处理任务',
      '  /todo list --json                                                      以 JSON 格式列出',
      '  /todo stats --json                                                     以 JSON 格式显示统计',
      '  /todo update todo_xxx completed                                        标记为已完成',
      '  /todo update todo_xxx in_progress "New description"                    更新状态和描述',
      '  /todo update todo_xxx in_progress --activeForm "Working on feature"    更新 activeForm',
      '  /todo delete todo_xxx                                                  删除任务',
      '  /todo clear-completed                                                  清除已完成任务',
      '  /todo write "Task 1" | "Task 2" | "Task 3"                            批量写入（覆盖原有列表）',
      '',
      '使用场景:',
      '  • 多步骤复杂任务（2个以上步骤）',
      '  • 用户明确要求使用 todo 追踪进度',
      '  • 开始新任务前规划工作项',
      '',
      '最佳实践:',
      '  • 同一时间只设置一个任务为 in_progress',
      '  • 完成后立即标记为 completed（不要批量操作）',
      '  • 遇到阻塞时创建新任务描述问题',
      '  • 添加失败的任务完成后标记为 completed',
    ].join('\n'),
  };
}

/**
 * 处理 add 子命令
 */
async function handleAdd(parts: string[]): Promise<CommandResult> {
  const args = stripFlags(parts.slice(1));
  const content = args.join(' ');

  if (!content) {
    return {
      success: false,
      error:
        '错误: 请指定任务内容\n用法: /todo add <content> [--activeForm <form>]',
    };
  }

  // 解析 --activeForm 标志
  const activeFormIdx = parts.indexOf('--activeForm');
  let activeForm = '';
  if (activeFormIdx !== -1 && activeFormIdx + 1 < parts.length) {
    activeForm = parts[activeFormIdx + 1];
  }

  try {
    const toolManager = getToolManager();
    const params: Record<string, unknown> = {
      action: 'add',
      content: content,
    };
    if (activeForm) {
      params.activeForm = activeForm;
    }

    const rawResult = await toolManager.executeTool('todo_write', params, {});

    if (rawResult.success && rawResult.data) {
      return { success: true, message: rawResult.data as string };
    }

    return { success: true, message: '待办事项已添加' };
  } catch (error) {
    return {
      success: false,
      error: `添加待办失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 处理 list 子命令
 */
async function handleList(parts: string[]): Promise<CommandResult> {
  const showJson = hasJsonFlag(parts);
  const statusFilter = stripFlags(parts.slice(1))[0] as TodoStatus | undefined;

  if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
    return {
      success: false,
      error: `错误: 无效状态 "${statusFilter}"，有效值为: ${VALID_STATUSES.join(', ')}`,
    };
  }

  try {
    const toolManager = getToolManager();
    const rawResult = await toolManager.executeTool(
      'todo_write',
      { action: 'list' },
      {}
    );

    const output = rawResult.data as string;

    if (
      !output ||
      typeof output !== 'string' ||
      output.startsWith('No todos')
    ) {
      if (showJson) {
        return {
          success: true,
          message: JSON.stringify({ todos: [], count: 0 }),
        };
      }
      return { success: true, message: '暂无待办事项' };
    }

    if (showJson) {
      // 从格式化输出解析出结构化数据
      const lines = output.split('\n');
      const todos: Array<{ id: string; content: string; status: TodoStatus }> =
        [];
      let currentTodo: Partial<{
        id: string;
        content: string;
        status: string;
      }> = {};

      for (const line of lines) {
        const idMatch = line.match(/ID:\s*(\S+)/);
        const statusMatch = line.match(/Status:\s*(\S+)/);
        const contentMatch = line.match(/\[[✓◐○]\].+(.+)/);

        if (idMatch) currentTodo.id = idMatch[1];
        if (statusMatch) currentTodo.status = statusMatch[1] as TodoStatus;
        if (contentMatch) currentTodo.content = contentMatch[1].trim();

        if (currentTodo.id && currentTodo.status) {
          todos.push(
            currentTodo as { id: string; content: string; status: TodoStatus }
          );
          currentTodo = {};
        }
      }

      const filtered = statusFilter
        ? todos.filter((t) => t.status === statusFilter)
        : todos;

      return {
        success: true,
        message: JSON.stringify(
          {
            todos: filtered,
            count: filtered.length,
            total: todos.length,
            filter: statusFilter || null,
          },
          null,
          2
        ),
      };
    }

    if (statusFilter) {
      // 过滤特定状态
      const lines = output.split('\n');
      const filteredLines: string[] = [];
      let inTargetSection = false;

      for (const line of lines) {
        if (line.startsWith('Todo List') || line.startsWith('=')) {
          filteredLines.push(line);
          continue;
        }
        if (line.trim() === '') {
          filteredLines.push(line);
          continue;
        }
        if (line.includes(`Status: ${statusFilter}`)) {
          inTargetSection = true;
          // 包含前一行（内容行）
          if (filteredLines.length > 0) {
            const prevLine = filteredLines[filteredLines.length - 1];
            if (
              prevLine.trim() !== '' &&
              !prevLine.startsWith('Todo List') &&
              !prevLine.startsWith('=')
            ) {
              // 保留内容行
            }
          }
          filteredLines.push(line);
        } else if (line.startsWith('  Pending')) {
          filteredLines.push(line);
        } else if (inTargetSection && line.includes('---')) {
          filteredLines.push(line);
          inTargetSection = false;
        }
      }

      return {
        success: true,
        message:
          filteredLines.join('\n') || `没有 ${statusFilter} 状态的待办事项`,
      };
    }

    return { success: true, message: output };
  } catch (error) {
    return {
      success: false,
      error: `列出待办失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 处理 stats 子命令
 */
async function handleStats(parts: string[]): Promise<CommandResult> {
  const showJson = hasJsonFlag(parts);

  try {
    const toolManager = getToolManager();
    const rawResult = await toolManager.executeTool(
      'todo_write',
      { action: 'list' },
      {}
    );

    const output = rawResult.data as string;

    if (
      !output ||
      typeof output !== 'string' ||
      output.startsWith('No todos')
    ) {
      if (showJson) {
        return {
          success: true,
          message: JSON.stringify({
            total: 0,
            pending: 0,
            inProgress: 0,
            completed: 0,
          }),
        };
      }
      return {
        success: true,
        message: '待办统计: 总计 0 | 待处理 0 | 进行中 0 | 已完成 0',
      };
    }

    // 从格式化输出解析统计信息
    const summaryMatch = output.match(/(\d+) items?/);
    const pendingMatch = output.match(/Pending:\s*(\d+)/);
    const inProgressMatch = output.match(/In Progress:\s*(\d+)/);
    const completedMatch = output.match(/Completed:\s*(\d+)/);

    const total = summaryMatch ? parseInt(summaryMatch[1], 10) : 0;
    const pending = pendingMatch ? parseInt(pendingMatch[1], 10) : 0;
    const inProgress = inProgressMatch ? parseInt(inProgressMatch[1], 10) : 0;
    const completed = completedMatch ? parseInt(completedMatch[1], 10) : 0;

    if (showJson) {
      return {
        success: true,
        message: JSON.stringify(
          { total, pending, inProgress, completed },
          null,
          2
        ),
      };
    }

    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    const barLength = 20;
    const filledLen = Math.round((completed / Math.max(total, 1)) * barLength);
    const bar = '█'.repeat(filledLen) + '░'.repeat(barLength - filledLen);

    return {
      success: true,
      message: [
        '待办统计:',
        `  总计: ${total} | 待处理: ${pending} | 进行中: ${inProgress} | 已完成: ${completed}`,
        `  进度: ${bar} ${progress}%`,
      ].join('\n'),
    };
  } catch (error) {
    return {
      success: false,
      error: `获取统计失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 处理 update 子命令
 */
async function handleUpdate(parts: string[]): Promise<CommandResult> {
  const args = stripFlags(parts.slice(1));
  const todoId = args[0];
  const status = args[1] as TodoStatus | undefined;
  const content = args.slice(2).join(' ');

  if (!todoId || !status) {
    return {
      success: false,
      error:
        '错误: 请指定待办 ID 和状态\n用法: /todo update <id> <status> [content] [--activeForm <form>]',
    };
  }

  if (!VALID_STATUSES.includes(status)) {
    return {
      success: false,
      error: `错误: 无效状态 "${status}"，有效值为: ${VALID_STATUSES.join(', ')}`,
    };
  }

  // 解析 --activeForm 标志
  const activeFormIdx = parts.indexOf('--activeForm');
  let activeForm = '';
  if (activeFormIdx !== -1 && activeFormIdx + 1 < parts.length) {
    activeForm = parts[activeFormIdx + 1];
  }

  try {
    const toolManager = getToolManager();
    const params: Record<string, unknown> = {
      action: 'update',
      todo_id: todoId,
      status: status,
    };
    if (content) params.content = content;
    if (activeForm) params.activeForm = activeForm;

    const rawResult = await toolManager.executeTool('todo_write', params, {});

    if (rawResult.success && rawResult.data) {
      return { success: true, message: rawResult.data as string };
    }

    return { success: true, message: '待办事项已更新' };
  } catch (error) {
    return {
      success: false,
      error: `更新待办失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 处理 delete 子命令
 */
async function handleDelete(parts: string[]): Promise<CommandResult> {
  const todoId = stripFlags(parts.slice(1))[0];

  if (!todoId) {
    return {
      success: false,
      error: '错误: 请指定待办 ID\n用法: /todo delete <id>',
    };
  }

  try {
    const toolManager = getToolManager();
    const rawResult = await toolManager.executeTool(
      'todo_write',
      { action: 'delete', todo_id: todoId },
      {}
    );

    if (rawResult.success && rawResult.data) {
      return { success: true, message: rawResult.data as string };
    }

    return { success: true, message: '待办事项已删除' };
  } catch (error) {
    return {
      success: false,
      error: `删除待办失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 处理 clear-completed 子命令
 */
async function handleClearCompleted(): Promise<CommandResult> {
  try {
    const toolManager = getToolManager();
    const rawResult = await toolManager.executeTool(
      'todo_write',
      { action: 'clear_completed' },
      {}
    );

    if (rawResult.success && rawResult.data) {
      return { success: true, message: rawResult.data as string };
    }

    return { success: true, message: '已完成待办已清除' };
  } catch (error) {
    return {
      success: false,
      error: `清除已完成待办失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 处理 write 子命令（批量写入，覆盖当前列表）
 * 格式: /todo write "Task 1" | "Task 2" | "Task 3"
 */
async function handleWrite(parts: string[]): Promise<CommandResult> {
  const args = stripFlags(parts.slice(1));
  const joined = args.join(' ');

  if (!joined) {
    return {
      success: false,
      error:
        '错误: 请指定任务列表\n用法: /todo write <content1> | <content2> | ...',
    };
  }

  // 支持 | 分隔和逗号分隔两种格式
  const items = joined.split(/\s*[|,]\s*/).filter(Boolean);

  if (items.length === 0) {
    return {
      success: false,
      error:
        '错误: 未解析到有效任务\n用法: /todo write <content1> | <content2> | ...',
    };
  }

  try {
    const toolManager = getToolManager();
    const todos = items.map((content) => ({ content, status: 'pending' }));
    const rawResult = await toolManager.executeTool(
      'todo_write',
      { action: 'write', todos },
      {}
    );

    if (rawResult.success && rawResult.data) {
      return { success: true, message: rawResult.data as string };
    }

    return { success: true, message: `已写入 ${items.length} 个待办事项` };
  } catch (error) {
    return {
      success: false,
      error: `批量写入待办失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Todo命令
 */
export const todoCommand: Command = {
  type: 'action',
  name: 'todo',
  description: '管理待办事项',
  aliases: [],
  argumentHint:
    '[add|list|stats|update|delete|clear-completed|write|help] [args]',
  whenToUse: '当你需要管理待办事项、跟踪多步骤任务进度时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return showHelp();
      }

      switch (subcommand) {
        case 'add':
          return handleAdd(parts);

        case 'list':
          return handleList(parts);

        case 'stats':
          return handleStats(parts);

        case 'update':
          return handleUpdate(parts);

        case 'delete':
          return handleDelete(parts);

        case 'clear-completed':
        case 'clear_completed':
        case 'clear':
          return handleClearCompleted();

        case 'write':
          return handleWrite(parts);

        default:
          return {
            success: false,
            error: `错误: 未知子命令 "${subcommand}"\n\n使用 /todo help 查看帮助`,
          };
      }
    },
  }),
};

export { getPromptForCommand };

export default todoCommand;
