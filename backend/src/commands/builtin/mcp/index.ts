/**
 * MCP 命令模块入口
 */
import type { Command } from '@modules/commands/types';
import mcpCommand from './MCP.js';

const command: Command = {
  type: 'local',
  name: 'mcp',
  description: 'MCP（Model Context Protocol）服务器查看和管理（列出服务器、工具和连接状态）',
  aliases: ['mcp-server', 'mcp-manager', 'model-context'],
  argumentHint: '[--list|-l] [--status|-s] [--tools|-t] [--test|-e] [status] [--json] [help] | run <action>',
  load: () => import('./MCP.js').then(m => m.default),
};

export { command as mcpCommand };
