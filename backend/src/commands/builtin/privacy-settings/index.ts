/**
 * 隐私设置命令
 * 管理隐私相关设置
 */
import type { Command } from '@modules/commands/types';

/**
 * privacy-settings 命令定义
 */
export const privacySettingsCommand: Command = {
  type: 'action',
  name: 'privacy-settings',
  description: '隐私设置',
  aliases: ['privacy'],
  argumentHint: '[show|update <项> <值>|reset|help]',
  whenToUse: '当你需要管理隐私设置时',
  load: async () =>
    import('./PrivacySettings.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};

export default privacySettingsCommand;
