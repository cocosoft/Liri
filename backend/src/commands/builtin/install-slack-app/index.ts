/**
 * Slack App安装命令
 * 安装Slack集成应用
 */
import type { Command } from '../../types/index.js';

/**
 * install-slack-app 命令定义
 */
export const installSlackAppCommand: Command = {
  type: 'action',
  name: 'install-slack-app',
  description: '安装Slack App',
  aliases: ['slack-app'],
  argumentHint: '',
  whenToUse: '当你需要安装Slack集成时',
  load: async () => import('./InstallSlackApp.js').then((m) => ({ execute: m.default.execute })),
};

export default installSlackAppCommand;
