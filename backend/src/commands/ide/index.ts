/**
 * IDE命令
 * 管理IDE集成和显示状态
 * 参考CC源码 cc_code/backend/commands/ide/index.ts 实现
 */

import type { Command } from '../types/index.js';

/**
 * IDE命令实现
 */
const ide: Command = {
  type: 'local',
  name: 'ide',
  description: '管理IDE集成和显示状态',
  argumentHint: '[open]',
  load: async () => {
    const { executeIDE } = await import('./ide.js');
    return {
      execute: executeIDE,
    };
  },
};

export default ide;
