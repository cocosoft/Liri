/**
 * `/budget` 命令注册（元数据 + 懒加载）。
 *
 * 与 `config` / `chat` 同一形态：元数据在此，实现体在 `./Budget.ts`（首次调用才加载）。
 */
import type { Command } from '@modules/commands';

export const budgetCommand: Command = {
  type: 'action',
  name: 'budget',
  description: '日预算限额（闸门 = 金额口径；status/boost/waive/unlock/set）',
  aliases: ['limits', 'quota'],
  argumentHint: '[status|boost|waive|unlock|set]',
  whenToUse:
    '当你需要查看日预算限额与闸门状态（Token 数字仅作观测、不拦截）、临时提额/单次放行/今日解除，或调整 Token 观测阈值时',
  load: async () =>
    import('./Budget.js').then((m) => ({
      execute: async (args: string) => {
        const result = await m.default.call(args);
        return {
          success: true,
          message: result.value,
        };
      },
    })),
};
