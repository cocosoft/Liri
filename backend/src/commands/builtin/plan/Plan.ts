/**
 * 计划命令实现
 */
import type { CommandContext, CommandResult } from '../../types/index.js';

export default {
  /**
   * 执行计划命令
   * @param args 子命令参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(' ');
    const subcommand = parts[0] || 'show';

    switch (subcommand.toLowerCase()) {
      case 'show':
        return this.handleShow(context);
      case 'create':
        return this.handleCreate(parts.slice(1), context);
      case 'add':
        return this.handleAdd(parts.slice(1), context);
      case 'remove':
        return this.handleRemove(parts.slice(1), context);
      case 'clear':
        return this.handleClear(context);
      case 'execute':
        return this.handleExecute(context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 显示当前计划
   */
  async handleShow(context: CommandContext): Promise<CommandResult> {
    const plan = {
      tasks: [
        { id: 1, description: '分析项目结构', status: 'completed', estimatedTime: '15min' },
        { id: 2, description: '设计API接口', status: 'completed', estimatedTime: '30min' },
        { id: 3, description: '实现核心功能', status: 'in_progress', estimatedTime: '1h' },
        { id: 4, description: '编写单元测试', status: 'pending', estimatedTime: '45min' },
        { id: 5, description: '文档编写', status: 'pending', estimatedTime: '30min' },
      ],
      totalTasks: 5,
      completedTasks: 2,
      inProgressTasks: 1,
      pendingTasks: 2,
    };

    const table = plan.tasks.map(task => {
      const statusIcon = task.status === 'completed' ? '✓' : task.status === 'in_progress' ? '○' : '○';
      return `${statusIcon} ${task.id.toString().padEnd(3)} ${task.status.padEnd(15)} ${task.description}`;
    }).join('\n');

    return {
      success: true,
      type: 'text',
      message: `当前计划:\n\n${table}\n\n` +
        `进度: ${plan.completedTasks}/${plan.totalTasks} 任务完成`,
      data: plan,
    };
  },

  /**
   * 创建新计划
   */
  async handleCreate(args: string[], context: CommandContext): Promise<CommandResult> {
    const planName = args.join(' ') || '新计划';
    
    context.onDone?.(`已创建计划: ${planName}`, { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: `已创建新计划: ${planName}`,
      data: { planName },
    };
  },

  /**
   * 添加任务到计划
   */
  async handleAdd(args: string[], context: CommandContext): Promise<CommandResult> {
    const taskDescription = args.join(' ');
    
    if (!taskDescription) {
      return {
        success: false,
        type: 'error',
        error: '请提供任务描述',
        message: '用法: /plan add <任务描述>',
      };
    }

    context.onDone?.(`已添加任务: ${taskDescription}`, { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: `已添加任务: ${taskDescription}`,
      data: { task: taskDescription },
    };
  },

  /**
   * 从计划中移除任务
   */
  async handleRemove(args: string[], context: CommandContext): Promise<CommandResult> {
    const taskId = args[0];
    
    if (!taskId) {
      return {
        success: false,
        type: 'error',
        error: '请提供任务ID',
        message: '用法: /plan remove <任务ID>',
      };
    }

    context.onDone?.(`已移除任务: ${taskId}`, { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: `已移除任务: ${taskId}`,
      data: { taskId },
    };
  },

  /**
   * 清空计划
   */
  async handleClear(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('计划已清空', { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: '计划已清空',
    };
  },

  /**
   * 执行计划
   */
  async handleExecute(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('开始执行计划', { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: '计划执行中...\n\n当前任务: 实现核心功能',
      data: { status: 'running' },
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `计划管理命令用法:

/plan show        - 显示当前计划
/plan create [名称] - 创建新计划
/plan add <任务>   - 添加任务
/plan remove <ID> - 移除任务
/plan clear       - 清空计划
/plan execute     - 执行计划
/plan help        - 显示此帮助信息

示例:
  /plan add 实现用户登录功能
  /plan show`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
