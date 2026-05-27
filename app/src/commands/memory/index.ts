/**
 * Memory命令（旧版）
 * 编辑PY_APP记忆文件（旧版，请使用 builtin/memory）
 */

import type { Command } from '@modules/commands/types';

/**
 * Memory命令实现（旧版）
 */
const memory: Command = {
  type: 'local',
  name: 'memory-legacy',
  description: '编辑PY_APP记忆文件（旧版）',
  load: async () => {
    const { executeMemory } = await import('./memory.js');
    return {
      execute: executeMemory,
    };
  },
};

export default memory;
