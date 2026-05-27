/**
 * Docs命令模块入口
 */
import type { Command } from '@modules/commands/types';

const docsCommand: Command = {
  type: 'local',
  name: 'docs',
  description: '查看文档（快速开始、命令系统、工具、技能、插件等详细说明）',
  aliases: ['doc', 'documentation', 'help-docs'],
  argumentHint: '[list|<章节名>|search <关键词>|help]',
  load: () => import('./Docs.js').then((m) => m.default),
};

export { docsCommand };
