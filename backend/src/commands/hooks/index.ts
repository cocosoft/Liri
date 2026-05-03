// @ts-nocheck
/**
 * Hooks命令
 * 查看工具事件的hook配置
 * 参考CC源码 cc_code/backend/commands/hooks/index.ts 实现
 */

import type { Command } from '../types/index.js';

/**
 * Hooks命令实现
 */
const hooks: Command = {
  type: 'local',
  name: 'hooks',
  description: '查看工具事件的hook配置',
  immediate: true,
  load: async () => {
    const { executeHooks } = await import('./hooks.js');
    return {
      execute: executeHooks,
    };
  },
};

export default hooks;
