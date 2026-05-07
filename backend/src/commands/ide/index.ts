/**
 * IDE 命令模块入口
 * 检测系统上已安装的 IDE，支持在当前 IDE 中打开项目目录
 */
import type { Command } from '@modules/commands/types';

const ideCommand: Command = {
  type: 'local',
  name: 'ide',
  description: '检测已安装的 IDE，在当前 IDE 中打开项目',
  aliases: ['editor'],
  argumentHint: '[open|list|--json|help]',
  whenToUse: '当你需要在系统上安装的 IDE 中打开当前项目目录时',
  load: () => import('./ide.js').then(m => m.default),
};

export { ideCommand };
export default ideCommand;
