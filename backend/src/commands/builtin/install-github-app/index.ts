/**
 * GitHub App安装命令
 * 安装GitHub集成应用
 */
import type { Command } from '../../types/index.js';

/**
 * install-github-app 命令定义
 */
export const installGithubAppCommand: Command = {
  type: 'action',
  name: 'install-github-app',
  description: '安装GitHub App',
  aliases: ['github-app'],
  argumentHint: '',
  whenToUse: '当你需要安装GitHub集成时',
  load: async () => import('./InstallGitHubApp.js').then((m) => ({ execute: m.default.execute })),
};