/**
 * 额外使用量命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

export default {
  /**
   * 执行额外使用量命令
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
      case 'purchase':
        return this.handlePurchase(parts.slice(1), context);
      case 'history':
        return this.handleHistory(context);
      case 'status':
        return this.handleStatus(context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 显示额外使用量
   */
  async handleShow(context: CommandContext): Promise<CommandResult> {
    const usage = {
      totalTokens: 150000,
      usedTokens: 45000,
      includedTokens: 100000,
      extraTokens: 0,
      costPerThousand: 0.003,
      extraCost: 0,
    };

    return {
      success: true,
      type: 'text',
      message:
        `使用量统计:\n` +
        `- 总Token: ${usage.totalTokens.toLocaleString()}\n` +
        `- 已使用: ${usage.usedTokens.toLocaleString()}\n` +
        `- 包含量: ${usage.includedTokens.toLocaleString()}\n` +
        `- 额外量: ${usage.extraTokens.toLocaleString()}\n` +
        `- 单位成本: $${usage.costPerThousand}/1K tokens\n` +
        `- 额外费用: $${usage.extraCost.toFixed(2)}`,
      data: usage,
    };
  },

  /**
   * 购买额外使用量
   */
  async handlePurchase(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    const amount = parseInt(args[0]) || 10000;

    if (amount < 1000) {
      return {
        success: false,
        type: 'error',
        error: '最小购买量为1000 tokens',
      };
    }

    const cost = (amount / 1000) * 0.003;

    context.onDone?.(`已购买 ${amount} tokens`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message:
        `购买成功!\n\n` +
        `- 购买量: ${amount.toLocaleString()} tokens\n` +
        `- 费用: $${cost.toFixed(2)}\n` +
        `- 状态: 已添加到账户`,
      data: { amount, cost },
    };
  },

  /**
   * 显示使用历史
   */
  async handleHistory(context: CommandContext): Promise<CommandResult> {
    const history = [
      { date: '2024-01-15', tokens: 12000, type: 'chat' },
      { date: '2024-01-14', tokens: 8500, type: 'review' },
      { date: '2024-01-13', tokens: 15000, type: 'chat' },
      { date: '2024-01-12', tokens: 5000, type: 'commit' },
      { date: '2024-01-11', tokens: 3000, type: 'other' },
    ];

    const table = history
      .map(
        (h) => `${h.date}  ${h.tokens.toLocaleString().padEnd(10)} ${h.type}`
      )
      .join('\n');

    return {
      success: true,
      type: 'text',
      message: `使用历史:\n\n日期         Token数      类型\n${table}`,
      data: history,
    };
  },

  /**
   * 显示订阅状态
   */
  async handleStatus(context: CommandContext): Promise<CommandResult> {
    const status = {
      plan: 'Pro',
      includedTokens: 100000,
      usedTokens: 45000,
      remainingTokens: 55000,
      renewalDate: '2024-02-01',
      autoRecharge: true,
      rechargeThreshold: 10000,
    };

    return {
      success: true,
      type: 'text',
      message:
        `订阅状态:\n` +
        `- 计划: ${status.plan}\n` +
        `- 包含Token: ${status.includedTokens.toLocaleString()}\n` +
        `- 已使用: ${status.usedTokens.toLocaleString()}\n` +
        `- 剩余: ${status.remainingTokens.toLocaleString()}\n` +
        `- 续期日期: ${status.renewalDate}\n` +
        `- 自动充值: ${status.autoRecharge ? '是' : '否'}\n` +
        `- 充值阈值: ${status.rechargeThreshold.toLocaleString()} tokens`,
      data: status,
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `额外使用量命令用法:

/extra-usage show      - 显示当前使用量
/extra-usage purchase <数量> - 购买额外Token
/extra-usage history   - 显示使用历史
/extra-usage status    - 显示订阅状态
/extra-usage help      - 显示此帮助信息

示例:
  /extra-usage show
  /extra-usage purchase 50000`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
