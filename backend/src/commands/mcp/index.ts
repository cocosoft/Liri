// @ts-nocheck
/**
 * MCP命令
 * 管理MCP服务器
 * 参考CC源码 cc_code/backend/commands/mcp/index.ts 实现
 */

import type { Command } from '@modules/commands/types';

/**
 * MCP命令实现
 */
const mcp: Command = {
  type: 'local',
  name: 'mcp',
  description: '管理MCP服务器',
  immediate: true,
  argumentHint: '[enable|disable [server-name]]',
  load: async () => {
    const { executeMCP } = await import('./mcp.js');
    return {
      execute: executeMCP,
    };
  },
};

export default mcp;
