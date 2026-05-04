/**
 * 堆转储命令
 * 生成堆内存快照
 */
import type { Command } from '../../types/index.js';

/**
 * heapdump 命令定义
 */
export const heapdumpCommand: Command = {
  type: 'action',
  name: 'heapdump',
  description: '生成堆转储',
  aliases: ['heap'],
  argumentHint: '',
  whenToUse: '当你需要调试内存问题时',
  load: async () => import('./Heapdump.js').then((m) => ({ execute: m.default.execute })),
};

