/**
 * 教程命令实现
 */
import type { CommandContext, CommandResult } from '../../types/index.js';

export default {
  /**
   * 执行教程命令
   * @param args 子命令参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(' ');
    const subcommand = parts[0] || 'list';

    switch (subcommand.toLowerCase()) {
      case 'list':
        return this.handleList(context);
      case 'start':
        return this.handleStart(parts[1], context);
      case 'progress':
        return this.handleProgress(context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 列出教程
   */
  async handleList(context: CommandContext): Promise<CommandResult> {
    const tutorials = [
      { id: 'intro', name: '入门指南', progress: 100, duration: '10分钟' },
      { id: 'commands', name: '命令系统', progress: 75, duration: '15分钟' },
      { id: 'ai', name: 'AI功能', progress: 50, duration: '20分钟' },
      { id: 'workspace', name: '工作区管理', progress: 0, duration: '12分钟' },
      { id: 'plugins', name: '插件系统', progress: 0, duration: '18分钟' },
    ];

    const table = tutorials.map(t => 
      `${t.id.padEnd(10)} ${t.name.padEnd(12)} ${t.progress}% ${t.duration}`
    ).join('\n');

    return {
      success: true,
      type: 'text',
      message: `可用教程:\n\n${table}`,
      data: tutorials,
    };
  },

  /**
   * 开始教程
   */
  async handleStart(id: string, context: CommandContext): Promise<CommandResult> {
    if (!id) {
      return {
        success: false,
        type: 'error',
        error: '请指定教程ID',
        message: '用法: /tutorial start <ID>',
      };
    }

    const tutorials: Record<string, string> = {
      intro: '入门指南',
      commands: '命令系统',
      ai: 'AI功能',
      workspace: '工作区管理',
      plugins: '插件系统',
    };

    const tutorialName = tutorials[id] || id;

    context.onDone?.(`正在开始教程: ${tutorialName}`, { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: `正在开始教程: ${tutorialName}\n\n` +
        '教程将在新窗口中打开。',
      data: { id, name: tutorialName },
    };
  },

  /**
   * 显示进度
   */
  async handleProgress(context: CommandContext): Promise<CommandResult> {
    const progress = {
      totalTutorials: 5,
      completed: 1,
      inProgress: 1,
      totalProgress: 45,
    };

    return {
      success: true,
      type: 'text',
      message: `📚 教程进度\n\n` +
        `总教程数: ${progress.totalTutorials}\n` +
        `已完成: ${progress.completed}\n` +
        `进行中: ${progress.inProgress}\n` +
        `总进度: ${progress.totalProgress}%`,
      data: progress,
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `教程命令用法:

/tutorial list       - 列出可用教程
/tutorial start <ID> - 开始教程
/tutorial progress   - 显示进度
/tutorial help       - 显示此帮助信息

示例:
  /tutorial list
  /tutorial start intro`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
