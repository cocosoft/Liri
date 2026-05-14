/**
 * Onboard命令实现
 * 应用入手指引和新手向导
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

const WIZARD_STEPS = [
  {
    title: '欢迎使用 PY_APP',
    guide: [
      '👋 欢迎！PY_APP 是一款智能 AI 编程助手。',
      '',
      '本向导将带你快速了解核心功能并完成初始配置。',
      '',
      '按 Enter 继续，或输入 "skip" 跳过，输入 "exit" 退出向导。',
    ].join('\n'),
  },
  {
    title: '步骤 1/5 - 选择 AI 模型',
    guide: [
      '📋 选择你偏好的 AI 模型：',
      '',
      '  1. Claude (Anthropic) - 推荐，擅长编程任务',
      '  2. GPT-4 (OpenAI)     - 通用能力强',
      '  3. 自定义              - 配置其他模型端点',
      '',
      '请选择 (1/2/3): ',
    ].join('\n'),
  },
  {
    title: '步骤 2/5 - 配置工作目录',
    guide: [
      '📂 配置默认工作目录：',
      '',
      '  默认工作目录是你使用文件操作时的基础路径。',
      '',
      '  当前默认: 当前项目目录',
      '',
      '输入新路径（留空使用默认）: ',
    ].join('\n'),
  },
  {
    title: '步骤 3/5 - 启用功能',
    guide: [
      '⚙️  选择要启用的功能：',
      '',
      '  [y/n] 自动补全 - Enter 启用',
      '  [y/n] Git 集成',
      '  [y/n] 多 Agent 协作',
      '  [y/n] 通道消息通知',
      '',
      '输入 y 启用，n 禁用，留空默认启用: ',
    ].join('\n'),
  },
  {
    title: '步骤 4/5 - 安全设置',
    guide: [
      '🔒 安全偏好设置：',
      '',
      '  1. 宽松模式 - 自动确认大多数操作',
      '  2. 标准模式 - 敏感操作需确认',
      '  3. 严格模式 - 所有操作需确认',
      '',
      '请选择 (1/2/3)，默认 2: ',
    ].join('\n'),
  },
  {
    title: '步骤 5/5 - 完成配置',
    guide: [
      '🎉 恭喜！初始配置已完成。',
      '',
      '快速入门：',
      '  /help      - 查看所有命令',
      '  /docs      - 查看文档',
      '  /chat      - 开始对话',
      '  /skill     - 管理技能',
      '',
      '祝你使用愉快！',
      '',
      '输入 "restart" 重新开始向导，或 "exit" 退出。',
    ].join('\n'),
  },
];

const onboardCommand = {
  /**
   * 执行 onboard 命令
   */
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    const cleanArgs = args.trim().toLowerCase();

    if (cleanArgs === 'help' || cleanArgs === '--help' || cleanArgs === '-h') {
      return this.showHelp();
    }

    if (cleanArgs === 'status') {
      return this.showStatus();
    }

    if (cleanArgs === 'reset') {
      return this.resetWizard();
    }

    if (cleanArgs === 'skip') {
      return this.skipWizard();
    }

    if (cleanArgs === 'quick' || cleanArgs === '--quick') {
      return this.quickStart();
    }

    return this.startWizard();
  },

  /**
   * 显示帮助信息
   */
  showHelp(): CommandResult {
    const help = [
      'Onboard 入手指引命令',
      '',
      '用法:',
      '  /onboard                   - 启动入手指引向导',
      '  /onboard quick             - 快速入门指引',
      '  /onboard status            - 查看配置状态',
      '  /onboard reset             - 重置向导状态',
      '  /onboard skip              - 跳过向导',
      '',
      '向导导航:',
      '  在向导中输入 Enter 继续，skip 跳过当前步骤，exit 退出向导。',
    ].join('\n');

    return { success: true, type: 'text', message: help };
  },

  /**
   * 显示配置状态
   */
  showStatus(): CommandResult {
    const lines = [
      '📊 配置状态',
      '',
      '  AI 模型:     未配置',
      '  工作目录:    当前项目目录',
      '  安全模式:    标准模式',
      '  功能:        基础功能',
      '  向导状态:    未完成',
      '',
      '使用 /onboard 启动入手指引完成配置。',
    ];

    return { success: true, type: 'text', message: lines.join('\n') };
  },

  /**
   * 重置向导
   */
  resetWizard(): CommandResult {
    return {
      success: true,
      type: 'text',
      message: '🔄 向导状态已重置。\n\n使用 /onboard 重新开始入手指引。',
    };
  },

  /**
   * 跳过向导
   */
  skipWizard(): CommandResult {
    return {
      success: true,
      type: 'text',
      message:
        '⏭️  已跳过入手指引。\n\n你可以随时使用 /onboard 重新开启。\n使用 /help 查看所有可用命令。',
    };
  },

  /**
   * 快速入门
   */
  quickStart(): CommandResult {
    const guide = [
      '🚀 PY_APP 快速入门',
      '',
      '1. 核心命令',
      '   /chat         开始与 AI 对话',
      '   /read         读取文件',
      '   /write        写入文件',
      '   /search       搜索代码',
      '   /list         浏览目录',
      '',
      '2. 管理功能',
      '   /skill list   查看可用技能',
      '   /config       配置应用',
      '   /plugins      管理插件',
      '   /docs         浏览文档',
      '',
      '3. 实用技巧',
      '   • 输入 /help <命令> 查看特定命令帮助',
      '   • 使用 Tab 键自动补全命令',
      '   • 使用 ↑/↓ 键浏览命令历史',
      '   • 输入 /docs search <关键词> 搜索文档',
      '',
      '4. 进阶功能',
      '   • 多 Agent 协作: /agent start',
      '   • 通道管理: /channel list',
      '   • 性能监控: /performance report',
      '',
      '祝使用愉快！🎉',
    ].join('\n');

    return { success: true, type: 'text', message: guide };
  },

  /**
   * 启动向导
   */
  startWizard(): CommandResult {
    const lines = [
      '📋 PY_APP 入手指引',
      '',
      '本向导将引导你完成 PY_APP 的初始配置。',
      '',
      '在交互模式下输入 /onboard 将启动交互式向导，',
      '在当前模式下将显示配置步骤概览。',
      '',
      '配置步骤:',
      ...WIZARD_STEPS.map((s, i) => `  ${i + 1}. ${s.title}`),
      '',
      '常用命令:',
      '  /onboard status  - 查看当前配置状态',
      '  /onboard quick   - 快速入门指引',
      '  /onboard reset   - 重置所有配置',
      '',
      '注意: 请进入交互模式（/chat）后执行 /onboard 启动完整的交互式向导。',
    ].join('\n');

    return { success: true, type: 'text', message: lines };
  },
};

export default onboardCommand;
