/**
 * Bridge 命令模块入口
 * 管理远程控制桥接连接
 */
import type { Command } from '@modules/commands/types';

const bridgeCommand: Command = {
  type: 'local',
  name: 'bridge',
  description: '管理远程控制桥接连接',
  aliases: ['rc', 'remote-control'],
  argumentHint: '[status|config|start|stop|connect|--json|help]',
  whenToUse: '管理 Bridge 远程控制连接，查看连接状态和配置',
  isHidden: false,
  load: () => import('./Bridge.js').then((m) => m.default),
};

export { bridgeCommand };
export default bridgeCommand;
