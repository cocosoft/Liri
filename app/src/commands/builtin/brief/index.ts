import { briefCommand } from './Brief.js';

export const brief = {
  name: 'brief',
  description: '生成当前会话的摘要，提取关键信息和决策点',
  aliases: ['summary', 'overview'],
  argumentHint: '[--length=<数字>] [--count=<数字>] [--type=<类型>]',
  type: 'local' as const,
  load: () => Promise.resolve(briefCommand),
};

export { briefCommand };
