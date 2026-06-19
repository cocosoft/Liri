/**
 * Tasks命令实现
 * 任务管理与跟踪
 */
import type { CommandContext, CommandResult } from '@modules/commands';

interface TaskItem {
  id: string;
  title: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  createdAt: string;
  updatedAt: string;
  assignee?: string;
  tags?: string[];
}

const MOCK_TASKS: TaskItem[] = [
  {
    id: 'T001',
    title: '代码审查 - API 模块',
    status: 'in-progress',
    priority: 'high',
    createdAt: '2026-05-14',
    updatedAt: '2026-05-14',
  },
  {
    id: 'T002',
    title: '更新项目文档',
    status: 'pending',
    priority: 'medium',
    createdAt: '2026-05-14',
    updatedAt: '2026-05-14',
  },
  {
    id: 'T003',
    title: '修复登录页面样式',
    status: 'completed',
    priority: 'high',
    createdAt: '2026-05-13',
    updatedAt: '2026-05-14',
  },
  {
    id: 'T004',
    title: '性能优化 - 数据库查询',
    status: 'pending',
    priority: 'critical',
    createdAt: '2026-05-13',
    updatedAt: '2026-05-13',
  },
  {
    id: 'T005',
    title: '新增单元测试',
    status: 'in-progress',
    priority: 'medium',
    createdAt: '2026-05-12',
    updatedAt: '2026-05-14',
  },
  {
    id: 'T006',
    title: '安全漏洞修复',
    status: 'failed',
    priority: 'critical',
    createdAt: '2026-05-12',
    updatedAt: '2026-05-13',
  },
];

const tasksCommand = {
  /**
   * 执行 tasks 命令
   */
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() || '';

    if (
      subcommand === 'help' ||
      subcommand === '--help' ||
      subcommand === '-h'
    ) {
      return this.showHelp();
    }

    if (subcommand === 'list' || !subcommand) {
      const filter = parts.slice(1).join(' ').toLowerCase();
      return this.listTasks(filter || undefined);
    }

    if (subcommand === 'add' || subcommand === 'create') {
      const title = parts.slice(1).join(' ');
      if (!title) {
        return {
          success: false,
          type: 'text',
          message: '请提供任务标题: /tasks add <标题>',
        };
      }
      return this.addTask(title);
    }

    if (subcommand === 'done' || subcommand === 'complete') {
      const taskId = parts[1]?.toUpperCase();
      if (!taskId) {
        return {
          success: false,
          type: 'text',
          message: '请提供任务ID: /tasks done <ID>',
        };
      }
      return this.completeTask(taskId);
    }

    if (subcommand === 'delete' || subcommand === 'remove') {
      const taskId = parts[1]?.toUpperCase();
      if (!taskId) {
        return {
          success: false,
          type: 'text',
          message: '请提供任务ID: /tasks delete <ID>',
        };
      }
      return this.deleteTask(taskId);
    }

    if (subcommand === 'priority') {
      const taskId = parts[1]?.toUpperCase();
      const priority = parts[2]?.toLowerCase() as
        | TaskItem['priority']
        | undefined;
      if (
        !taskId ||
        !priority ||
        !['low', 'medium', 'high', 'critical'].includes(priority)
      ) {
        return {
          success: false,
          type: 'text',
          message: '用法: /tasks priority <ID> <low|medium|high|critical>',
        };
      }
      return this.setPriority(taskId, priority);
    }

    if (subcommand === 'stats' || subcommand === 'statistics') {
      return this.showStats();
    }

    if (subcommand) {
      const taskId = subcommand.toUpperCase();
      return this.showTask(taskId);
    }

    return this.listTasks();
  },

  /**
   * 显示帮助信息
   */
  showHelp(): CommandResult {
    const help = [
      'Tasks 任务管理命令',
      '',
      '用法:',
      '  /tasks                    - 列出所有任务',
      '  /tasks list [过滤词]      - 列出任务（可过滤）',
      '  /tasks <ID>               - 查看任务详情',
      '  /tasks add <标题>         - 添加新任务',
      '  /tasks done <ID>          - 完成任务',
      '  /tasks delete <ID>        - 删除任务',
      '  /tasks priority <ID> <级别> - 设置优先级',
      '  /tasks stats              - 查看任务统计',
      '  /tasks help               - 显示此帮助信息',
      '',
      '优先级: low, medium, high, critical',
      '',
      '示例:',
      '  /tasks list pending',
      '  /tasks add 修复登录页面Bug',
      '  /tasks done T003',
      '  /tasks priority T001 high',
    ].join('\n');

    return { success: true, type: 'text', message: help };
  },

  /**
   * 列出任务
   */
  listTasks(filter?: string): CommandResult {
    let filtered = [...MOCK_TASKS];

    if (filter) {
      filtered = filtered.filter(
        (t) =>
          t.title.toLowerCase().includes(filter) ||
          t.status.toLowerCase().includes(filter) ||
          t.priority.toLowerCase().includes(filter) ||
          t.id.toLowerCase().includes(filter)
      );
    }

    if (filtered.length === 0) {
      return {
        success: true,
        type: 'text',
        message: filter
          ? `未找到与 "${filter}" 匹配的任务。`
          : '暂无任务。使用 /tasks add <标题> 添加新任务。',
      };
    }

    const statusIcon = (status: TaskItem['status']): string => {
      switch (status) {
        case 'completed':
          return '✅';
        case 'in-progress':
          return '🔄';
        case 'failed':
          return '❌';
        case 'pending':
          return '⏳';
      }
    };

    const priorityLabel = (p: TaskItem['priority']): string => {
      switch (p) {
        case 'critical':
          return '🔴 紧急';
        case 'high':
          return '🟠 高';
        case 'medium':
          return '🟡 中';
        case 'low':
          return '🟢 低';
      }
    };

    const lines = [
      `📋 任务列表 (${filtered.length} 项)`,
      '',
      ...filtered.map(
        (t) =>
          `  ${statusIcon(t.status)} [${t.id}] ${t.title}\n     ${priorityLabel(t.priority)} | ${t.status}`
      ),
      '',
      '使用 /tasks <ID> 查看详情，/tasks help 查看更多操作。',
    ];

    return {
      success: true,
      type: 'text',
      message: lines.join('\n'),
      data: filtered,
    };
  },

  /**
   * 查看任务详情
   */
  showTask(taskId: string): CommandResult {
    const task = MOCK_TASKS.find((t) => t.id === taskId);
    if (!task) {
      return {
        success: false,
        type: 'text',
        message: `未找到任务: ${taskId}\n使用 /tasks list 查看所有任务。`,
      };
    }

    const statusLabel: Record<string, string> = {
      pending: '⏳ 待处理',
      'in-progress': '🔄 进行中',
      completed: '✅ 已完成',
      failed: '❌ 失败',
    };

    const priorityLabel: Record<string, string> = {
      low: '🟢 低',
      medium: '🟡 中',
      high: '🟠 高',
      critical: '🔴 紧急',
    };

    const lines = [
      `📋 任务详情: ${task.id}`,
      '',
      `  标题: ${task.title}`,
      `  状态: ${statusLabel[task.status] || task.status}`,
      `  优先级: ${priorityLabel[task.priority] || task.priority}`,
      `  创建时间: ${task.createdAt}`,
      `  更新时间: ${task.updatedAt}`,
      task.assignee ? `  负责人: ${task.assignee}` : '',
      task.tags ? `  标签: ${task.tags.join(', ')}` : '',
    ];

    return {
      success: true,
      type: 'text',
      message: lines.filter(Boolean).join('\n'),
      data: task,
    };
  },

  /**
   * 添加新任务
   */
  addTask(title: string): CommandResult {
    const taskId = `T${String(MOCK_TASKS.length + 1).padStart(3, '0')}`;

    MOCK_TASKS.push({
      id: taskId,
      title,
      status: 'pending',
      priority: 'medium',
      createdAt: new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString().split('T')[0],
    });

    return {
      success: true,
      type: 'text',
      message: `✅ 任务已创建: [${taskId}] ${title}\n使用 /tasks ${taskId} 查看详情。`,
      data: { id: taskId, title },
    };
  },

  /**
   * 完成任务
   */
  completeTask(taskId: string): CommandResult {
    const task = MOCK_TASKS.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, type: 'text', message: `未找到任务: ${taskId}` };
    }

    task.status = 'completed';
    task.updatedAt = new Date().toISOString().split('T')[0];

    return {
      success: true,
      type: 'text',
      message: `✅ 任务已完成: [${task.id}] ${task.title}`,
      data: task,
    };
  },

  /**
   * 删除任务
   */
  deleteTask(taskId: string): CommandResult {
    const index = MOCK_TASKS.findIndex((t) => t.id === taskId);
    if (index === -1) {
      return { success: false, type: 'text', message: `未找到任务: ${taskId}` };
    }

    const task = MOCK_TASKS[index];
    MOCK_TASKS.splice(index, 1);

    return {
      success: true,
      type: 'text',
      message: `🗑️ 任务已删除: [${task.id}] ${task.title}`,
      data: task,
    };
  },

  /**
   * 设置优先级
   */
  setPriority(taskId: string, priority: TaskItem['priority']): CommandResult {
    const task = MOCK_TASKS.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, type: 'text', message: `未找到任务: ${taskId}` };
    }

    task.priority = priority;
    task.updatedAt = new Date().toISOString().split('T')[0];

    return {
      success: true,
      type: 'text',
      message: `✅ 任务优先级已更新: [${task.id}] ${task.title} -> ${priority}`,
      data: task,
    };
  },

  /**
   * 显示任务统计
   */
  showStats(): CommandResult {
    const total = MOCK_TASKS.length;
    const completed = MOCK_TASKS.filter((t) => t.status === 'completed').length;
    const inProgress = MOCK_TASKS.filter(
      (t) => t.status === 'in-progress'
    ).length;
    const pending = MOCK_TASKS.filter((t) => t.status === 'pending').length;
    const failed = MOCK_TASKS.filter((t) => t.status === 'failed').length;
    const critical = MOCK_TASKS.filter(
      (t) => t.priority === 'critical' && t.status !== 'completed'
    ).length;

    const lines = [
      '📊 任务统计',
      '',
      `  总任务数: ${total}`,
      `  ✅ 已完成: ${completed}`,
      `  🔄 进行中: ${inProgress}`,
      `  ⏳ 待处理: ${pending}`,
      `  ❌ 失败: ${failed}`,
      '',
      `  🔴 未完成的紧急任务: ${critical}`,
      `  完成率: ${total > 0 ? ((completed / total) * 100).toFixed(1) : '0'}%`,
    ];

    return {
      success: true,
      type: 'text',
      message: lines.join('\n'),
      data: { total, completed, inProgress, pending, failed },
    };
  },
};

export default tasksCommand;
