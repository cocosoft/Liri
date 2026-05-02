/**
 * Memory命令
 * 编辑PY_APP记忆文件
 * 参考CC源码 cc_code/backend/commands/memory/index.ts 实现
 */

import type { Command } from '../types/index.js';

/**
 * Memory命令实现
 */
const memory: Command = {
  type: 'local',
  name: 'memory',
  description: '编辑PY_APP记忆文件',
  load: async () => {
    const { executeMemory } = await import('./memory.js');
    return {
      execute: executeMemory,
    };
  },
};

export default memory;
