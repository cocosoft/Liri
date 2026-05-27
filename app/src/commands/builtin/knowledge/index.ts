/**
 * Knowledge命令模块入口
 */
import type { Command } from '@modules/commands/types';

const knowledgeCommand: Command = {
  type: 'local',
  name: 'knowledge',
  description: '管理用户知识库（创建、编辑、删除、搜索文档）',
  aliases: ['kb', 'wiki', 'note'],
  argumentHint:
    '[list|<标题>|create <标题>|edit <标题>|delete <标题>|search <关键词>|help]',
  load: () => import('./Knowledge.js').then((m) => m.default),
};

export { knowledgeCommand };
