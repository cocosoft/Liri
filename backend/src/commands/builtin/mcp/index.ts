/**
 * MCP命令模块入口
 */
import { MCP } from './MCP.js';
import type { Command } from '../../types/index.js';

/**
 * MCP命令定义
 */
const mcpCommand: Command = {
  type: 'local',
  name: 'mcp',
  description: 'MCP（Model Context Protocol）管理和配置',
  aliases: ['mcp-server', 'model-context'],
  argumentHint: '[--list|-l] [--status|-s] [--manage|-m] [--resources|-r] [--tools|-t] [--test|-e]',
  whenToUse: '查看MCP服务器状态、管理MCP资源和工具时使用',
  version: '1.0.0',
  userInvocable: true,
  loadedFrom: 'builtin',
  
  /**
   * 加载命令实现
   */
  async load(): Promise<any> {
    return new MCP();
  }
};

/**
 * 导出MCP命令实现
 */
export { MCP };

/**
 * 默认导出MCP命令定义
 */
export default mcpCommand;