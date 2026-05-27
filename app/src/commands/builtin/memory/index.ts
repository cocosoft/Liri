/**
 * Memory 命令模块入口
 */
import type { Command } from '@modules/commands/types';

const memoryCommand: Command = {
  type: 'local',
  name: 'memory',
  description: '记忆文件管理（查看、创建、编辑、删除 .md 记忆文件）',
  aliases: ['mem', '记忆'],
  argumentHint:
    '[--list|-l] [--create|-c <name>] [--show|-s <name>] [--edit|-e <name>] [--delete|-d <name>] [status] [--json] [help]',
  load: () => import('./Memory.js').then((m) => m.default),
};

export { memoryCommand };
