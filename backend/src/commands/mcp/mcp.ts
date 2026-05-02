/**
 * MCP命令执行逻辑
 * 管理MCP服务器
 * 参考CC源码 cc_code/backend/commands/mcp/mcp.tsx 实现
 */

import type { CommandContext, CommandResult } from '../types/index.js';

/**
 * MCP服务器配置
 */
interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

/**
 * 获取MCP服务器配置
 */
function getMCPServers(): MCPServerConfig[] {
  const mcpEnv = process.env.PY_APP_MCP_SERVERS;

  if (mcpEnv) {
    try {
      return JSON.parse(mcpEnv);
    } catch {
      // 解析失败
    }
  }

  // 返回默认服务器配置
  return [
    {
      name: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
      env: {},
      enabled: false,
    },
    {
      name: 'memory',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      env: {},
      enabled: false,
    },
  ];
}

/**
 * 保存MCP服务器配置
 */
function saveMCPServers(servers: MCPServerConfig[]): void {
  process.env.PY_APP_MCP_SERVERS = JSON.stringify(servers);
}

/**
 * 执行MCP命令
 */
export async function executeMCP(
  args: string,
  _context: CommandContext
): Promise<CommandResult> {
  try {
    const params = parseMCPArgs(args);
    const servers = getMCPServers();

    // list子命令
    if (params.subcommand === 'list' || !params.subcommand) {
      if (servers.length === 0) {
        return {
          type: 'text',
          success: true,
          message: '没有配置MCP服务器。使用 /mcp add <name> <command> 添加服务器。',
        };
      }

      const output = servers
        .map(
          (s) =>
            `  ${s.enabled ? '●' : '○'} ${s.name}: ${s.command} ${s.args.join(' ')}`
        )
        .join('\n');

      return {
        type: 'text',
        success: true,
        message: `已配置的MCP服务器:\n\n${output}`,
      };
    }

    // add子命令
    if (params.subcommand === 'add') {
      if (!params.name || !params.command) {
        return {
          type: 'text',
          success: false,
          message: 'Usage: /mcp add <name> <command> [args...]',
        };
      }

      // 检查是否已存在
      if (servers.find((s) => s.name === params.name)) {
        return {
          type: 'text',
          success: false,
          message: `MCP服务器 "${params.name}" 已存在`,
        };
      }

      servers.push({
        name: params.name,
        command: params.command,
        args: params.args || [],
        env: {},
        enabled: true,
      });

      saveMCPServers(servers);

      return {
        type: 'text',
        success: true,
        message: `MCP服务器 "${params.name}" 已添加`,
      };
    }

    // remove子命令
    if (params.subcommand === 'remove') {
      if (!params.name) {
        return {
          type: 'text',
          success: false,
          message: 'Usage: /mcp remove <name>',
        };
      }

      const index = servers.findIndex((s) => s.name === params.name);
      if (index === -1) {
        return {
          type: 'text',
          success: false,
          message: `MCP服务器 "${params.name}" 不存在`,
        };
      }

      servers.splice(index, 1);
      saveMCPServers(servers);

      return {
        type: 'text',
        success: true,
        message: `MCP服务器 "${params.name}" 已移除`,
      };
    }

    // enable子命令
    if (params.subcommand === 'enable') {
      if (!params.name) {
        return {
          type: 'text',
          success: false,
          message: 'Usage: /mcp enable <name>',
        };
      }

      const server = servers.find((s) => s.name === params.name);
      if (!server) {
        return {
          type: 'text',
          success: false,
          message: `MCP服务器 "${params.name}" 不存在`,
        };
      }

      server.enabled = true;
      saveMCPServers(servers);

      return {
        type: 'text',
        success: true,
        message: `MCP服务器 "${params.name}" 已启用`,
      };
    }

    // disable子命令
    if (params.subcommand === 'disable') {
      if (!params.name) {
        return {
          type: 'text',
          success: false,
          message: 'Usage: /mcp disable <name>',
        };
      }

      const server = servers.find((s) => s.name === params.name);
      if (!server) {
        return {
          type: 'text',
          success: false,
          message: `MCP服务器 "${params.name}" 不存在`,
        };
      }

      server.enabled = false;
      saveMCPServers(servers);

      return {
        type: 'text',
        success: true,
        message: `MCP服务器 "${params.name}" 已禁用`,
      };
    }

    return {
      type: 'text',
      success: false,
      message: `未知子命令: ${params.subcommand}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      type: 'error',
      success: false,
      message: `MCP命令执行失败: ${errorMessage}`,
    };
  }
}

/**
 * 解析MCP命令参数
 */
function parseMCPArgs(args: string): {
  subcommand?: string;
  name?: string;
  command?: string;
  args?: string[];
} {
  const params: {
    subcommand?: string;
    name?: string;
    command?: string;
    args?: string[];
  } = {};

  if (!args) return params;

  const parts = args.trim().split(/\s+/);
  params.subcommand = parts[0];

  if (params.subcommand === 'add') {
    params.name = parts[1];
    params.command = parts[2];
    params.args = parts.slice(3);
  } else if (params.subcommand === 'remove' || params.subcommand === 'enable' || params.subcommand === 'disable') {
    params.name = parts[1];
  }

  return params;
}
