/**
 * Pricing 命令入口
 * 导出为 default，兼容 LazyCommand 懒加载
 */
import type { Command } from '@modules/commands/types';

export const pricingCommand: Command = {
  type: 'local',
  name: 'pricing',
  description: '查看和管理模型定价',
  aliases: ['prices', 'model-pricing'],
  argumentHint: '[list|set|sync|reset|help] [--model=] [--json] [--source=]',
  load: () => import('./Pricing.js').then((m) => m.default),
};
