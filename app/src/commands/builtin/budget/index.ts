/**
 * `/budget` 命令注册（元数据 + 懒加载）。
 *
 * 与 `config` / `chat` 同一形态：元数据在此，实现体在 `./Budget.ts`（首次调用才加载）。
 */
import type { Command } from '@modules/commands';

export const budgetCommand: Command = {
  type: 'action',
  name: 'budget',
  description: '日 Token 限额（status/boost/waive/unlock/set）',
  aliases: ['limits', 'quota'],
  argumentHint: '[status|boost|waive|unlock|set]',
  whenToUse:
    '当你需要查看日 Token 限额、临时提额/单次放行/今日解除，或调整日上限时',
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
