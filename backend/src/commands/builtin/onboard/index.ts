/**
 * Onboard命令模块入口
 * 应用入手指引和新手向导
 */
import type { Command } from '@modules/commands/types';

const onboardCommand: Command = {
  type: 'local',
  name: 'onboard',
  description: '应用入手指引和新手向导（启动配置向导/查看状态/快速入门）',
  aliases: ['welcome', 'setup', 'getting-started'],
  argumentHint: '[status|reset|skip|quick|help]',
  load: () => import('./Onboard.js').then((m) => m.default),
};

export { onboardCommand };
