/**
 * 发布说明命令
 * 查看版本发布说明
 */
import type { Command } from '../../types/index.js';

/**
 * release-notes 命令定义
 */
export const releaseNotesCommand: Command = {
  type: 'action',
  name: 'release-notes',
  description: '发布说明',
  aliases: ['changelog', 'releases'],
  argumentHint: '[latest|all|version|search|help]',
  whenToUse: '当你需要查看版本更新历史时',
  load: async () => import('./ReleaseNotes.js').then((m) => ({ execute: m.default.execute })),
};

export default releaseNotesCommand;
