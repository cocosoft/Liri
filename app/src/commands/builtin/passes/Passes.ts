/**
 * Pass管理命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands';

export default {
  /**
   * 执行Pass管理命令
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
      case 'activate':
        return this.handleActivate(parts.slice(1), context);
      case 'deactivate':
        return this.handleDeactivate(parts.slice(1), context);
      case 'status':
        return this.handleStatus(context);
      case 'info':
        return this.handleInfo(parts[1], context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 列出所有Pass
   */
  async handleList(context: CommandContext): Promise<CommandResult> {
    const passes = [
      {
        id: 'pro',
        name: 'Pro Pass',
        status: 'active',
        features: ['高级AI模型', '无限历史', '优先支持'],
      },
      {
        id: 'team',
        name: 'Team Pass',
        status: 'available',
        features: ['团队协作', '共享工作区', '审计日志'],
      },
      {
        id: 'enterprise',
        name: 'Enterprise Pass',
        status: 'available',
        features: ['私有化部署', '定制开发', '专属客服'],
      },
    ];

    const table = passes
      .map(
        (p) =>
          `${p.status === 'active' ? '[ACTIVE]' : '[AVAIL]'} ${p.name.padEnd(20)} - ${p.id}`
      )
      .join('\n');

    return {
      success: true,
      type: 'text',
      message: `可用Pass:\n\n${table}\n\n使用 /passes activate <id> 激活Pass`,
      data: passes,
    };
  },

  /**
   * 激活Pass
   */
  async handleActivate(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    const passId = args[0];

    if (!passId) {
      return {
        success: false,
        type: 'error',
        error: '请指定Pass ID',
        message: '用法: /passes activate <pass-id>',
      };
    }

    context.onDone?.(`Pass ${passId} 已激活`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `Pass ${passId} 已激活`,
      data: { passId, action: 'activated' },
    };
  },

  /**
   * 停用Pass
   */
  async handleDeactivate(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    const passId = args[0];

    if (!passId) {
      return {
        success: false,
        type: 'error',
        error: '请指定Pass ID',
        message: '用法: /passes deactivate <pass-id>',
      };
    }

    context.onDone?.(`Pass ${passId} 已停用`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `Pass ${passId} 已停用`,
      data: { passId, action: 'deactivated' },
    };
  },

  /**
   * 显示Pass状态
   */
  async handleStatus(context: CommandContext): Promise<CommandResult> {
    const status = {
      activePass: 'pro',
      subscriptionType: 'monthly',
      expiresAt: '2024-02-15',
      features: ['高级AI模型', '无限历史', '优先支持'],
    };

    return {
      success: true,
      type: 'text',
      message:
        `Pass状态:\n` +
        `- 当前Pass: ${status.activePass}\n` +
        `- 订阅类型: ${status.subscriptionType}\n` +
        `- 到期时间: ${status.expiresAt}\n\n` +
        `可用功能:\n` +
        `${status.features.map((f) => `- ${f}`).join('\n')}`,
      data: status,
    };
  },

  /**
   * 显示Pass详情
   */
  async handleInfo(
    passId: string,
    context: CommandContext
  ): Promise<CommandResult> {
    const passInfo: Record<
      string,
      { name: string; description: string; price: string; features: string[] }
    > = {
      pro: {
        name: 'Pro Pass',
        description: '专业版Pass，适合个人开发者',
        price: '$19/month',
        features: ['高级AI模型', '无限历史记录', '优先技术支持', '自定义主题'],
      },
      team: {
        name: 'Team Pass',
        description: '团队版Pass，适合小团队协作',
        price: '$49/month',
        features: ['Pro版所有功能', '团队协作', '共享工作区', '审计日志'],
      },
      enterprise: {
        name: 'Enterprise Pass',
        description: '企业版Pass，适合大型企业',
        price: '定制报价',
        features: ['Team版所有功能', '私有化部署', '定制开发', '专属客服'],
      },
    };

    const info = passInfo[passId];

    if (info) {
      return {
        success: true,
        type: 'text',
        message:
          `${info.name}\n` +
          `- 描述: ${info.description}\n` +
          `- 价格: ${info.price}\n\n` +
          `功能:\n` +
          `${info.features.map((f) => `- ${f}`).join('\n')}`,
        data: info,
      };
    }

    return {
      success: false,
      type: 'error',
      error: `未找到Pass: ${passId}`,
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `Pass管理命令用法:

/passes list         - 列出所有Pass
/passes activate <id> - 激活Pass
/passes deactivate <id> - 停用Pass
/passes status       - 显示当前Pass状态
/passes info <id>    - 显示Pass详情
/passes help         - 显示此帮助信息

示例:
  /passes list
  /passes activate pro
  /passes info team`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
