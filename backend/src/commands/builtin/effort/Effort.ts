//
/**
 * Effort设置命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

export type EffortLevel = 'low' | 'medium' | 'high' | 'auto';

export default {
  /**
   * 执行effort命令
   * @param args effort级别
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const level = args.trim().toLowerCase() as EffortLevel;
    
    const validLevels: EffortLevel[] = ['low', 'medium', 'high', 'auto'];
    
    if (!level || level === 'show') {
      return this.handleShow(context);
    }
    
    if (!validLevels.includes(level)) {
      return {
        success: false,
        type: 'error',
        error: `无效的effort级别: ${level}`,
        message: '有效的级别: low, medium, high, auto',
      };
    }

    return this.handleSet(level, context);
  },

  /**
   * 显示当前effort设置
   */
  async handleShow(context: CommandContext): Promise<CommandResult> {
    // 获取当前设置（从配置或默认值）
    const currentLevel = context.environment?.EFFORT_LEVEL || 'auto';
    
    const levelDescriptions: Record<string, string> = {
      low: '低 - 快速响应，较少细节',
      medium: '中 - 平衡响应速度和详细程度',
      high: '高 - 详细分析，较慢响应',
      auto: '自动 - 根据任务自动调整',
    };

    return {
      success: true,
      type: 'text',
      message: `当前 Effort 级别: ${levelDescriptions[currentLevel] || currentLevel}\n\n` +
        '使用 /effort <级别> 更改设置\n' +
        '级别: low, medium, high, auto',
      data: { level: currentLevel },
    };
  },

  /**
   * 设置effort级别
   */
  async handleSet(level: EffortLevel, context: CommandContext): Promise<CommandResult> {
    const levelDescriptions: Record<string, string> = {
      low: '低级别',
      medium: '中级别',
      high: '高级别',
      auto: '自动模式',
    };

    // 更新配置
    if (context.environment) {
      context.environment.EFFORT_LEVEL = level;
    }

    context.onDone?.(`Effort级别已设置为: ${levelDescriptions[level]}`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `Effort级别已设置为: ${levelDescriptions[level]}`,
      data: { level },
    };
  },
};
