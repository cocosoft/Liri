/**
 * MCP 命令 - Model Context Protocol 管理和查看
 * 查看和管理 MCP 服务器、资源和工具
 * 对标 CC 源码 cc_code/backend/commands/mcp/mcp.tsx
 */
import type { CommandContext } from '@modules/commands';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('commands:builtin:mcp:MCP');

/**
 * 简易服务器信息（展示用）
 */
interface ServerInfo {
  name: string;
  type: string;
  status: string;
  toolsCount: number;
  toolNames: string[];
  error?: string;
}

/**
 * 尝试获取所有 MCP 服务器信息
 */
async function getServers(): Promise<ServerInfo[]> {
  try {
    const { mcpConnectionManager } =
      await import('@modules/services/mcp/MCPConnectionManager.js');
    const connections = mcpConnectionManager.getServers();

    return connections.map((conn: any) => ({
      name: conn.name,
      type: conn.type,
      status:
        conn.type === 'connected'
          ? '已连接'
          : conn.type === 'failed'
            ? '错误'
            : conn.type === 'disabled'
              ? '禁用'
              : '待连接',
      toolsCount: 0,
      toolNames: [],
      error: conn.type === 'failed' ? conn.error : undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * 尝试获取指定服务器的工具列表
 */
async function getServerTools(serverName: string): Promise<string[]> {
  try {
    const { mcpConnectionManager } =
      await import('@modules/services/mcp/MCPConnectionManager.js');
    const tools = mcpConnectionManager.getServerTools(serverName);
    return tools.map((t: any) => t.name);
  } catch {
    return [];
  }
}

/**
 * 收集所有 MCP 数据（服务器 + 各服务器工具数）
 */
async function collectMCPData(): Promise<{
  servers: ServerInfo[];
  totalTools: number;
  totalServers: number;
  connectedCount: number;
  failedCount: number;
  disabledCount: number;
}> {
  const servers = await getServers();

  let totalTools = 0;
  for (const s of servers) {
    if (s.status === '已连接') {
      const toolNames = await getServerTools(s.name);
      s.toolsCount = toolNames.length;
      s.toolNames = toolNames;
      totalTools += toolNames.length;
    }
  }

  return {
    servers,
    totalTools,
    totalServers: servers.length,
    connectedCount: servers.filter((s) => s.type === 'connected').length,
    failedCount: servers.filter((s) => s.type === 'failed').length,
    disabledCount: servers.filter((s) => s.type === 'disabled').length,
  };
}

const mcpCommand = {
  async execute(args: string, _context: CommandContext) {
    const trimmed = args.trim();

    if (
      trimmed === '-h' ||
      trimmed === '--help' ||
      trimmed === 'help' ||
      !trimmed
    ) {
      return this.showHelp();
    }

    const useJson = trimmed.includes('--json');
    const cleanArgs = trimmed.replace(/--json\s*/g, '').trim();

    if (cleanArgs === 'status') {
      return this.showStatus(useJson);
    }

    if (useJson && !cleanArgs) {
      const data = await collectMCPData();
      return { success: true, message: JSON.stringify(data, null, 2) };
    }

    // 检查 run 子命令
    const runMatch = cleanArgs.match(/^run\s+(.+)$/);
    if (runMatch) {
      return this.runToolAction(runMatch[1]);
    }

    // 2026-08-06 新增：安装 MCP 服务器（从市场）/mcp install <serverId>
    const installMatch = cleanArgs.match(/^install\s+(.+)$/);
    if (installMatch) {
      return await this.installServer(installMatch[1].trim());
    }

    const parts = cleanArgs.split(/\s+/);
    const subcommand = parts[0];

    try {
      switch (subcommand) {
        case '--list':
        case '-l':
          return await this.listServers(useJson);
        case '--status':
        case '-s':
          return await this.showStatus(useJson);
        case '--tools':
        case '-t':
          return await this.listTools(useJson);
        case '--test':
        case '-e':
          return await this.testConnections(useJson);
        default:
          return await this.listServers(useJson);
      }
    } catch (error) {
      return {
        success: false,
        message: `操作失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * 安装 MCP 服务器（从市场）
   * 2026-08-06 新增：复用 mcpSystem.marketplace.install 链路，与 HTTP 端点 /v1/mcp/marketplace/servers/:serverId/install 同源
   */
  async installServer(serverName: string) {
    try {
      const { mcpSystem } = await import('@modules/services/mcp');
      if (!mcpSystem || !mcpSystem.marketplace) {
        return { success: false, message: 'MCP 市场服务未初始化' };
      }
      await mcpSystem.marketplace.install(serverName);
      return { success: true, message: `已安装 MCP 服务器: ${serverName}` };
    } catch (error) {
      return {
        success: false,
        message: `安装失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  showHelp() {
    return {
      success: true,
      message: [
        'MCP 系统帮助',
        '=============',
        '',
        '查看和管理 MCP（Model Context Protocol）服务器。MCP 是用于扩展 AI 助手功能的协议。',
        '',
        '用法:',
        '  /mcp                   - 列出所有 MCP 服务器',
        '  /mcp --list (-l)       - 列出所有 MCP 服务器',
        '  /mcp --status (-s)     - 显示 MCP 状态报告',
        '  /mcp --tools (-t)      - 显示 MCP 工具列表',
        '  /mcp --test (-e)       - 测试 MCP 连接',
        '  /mcp status            - 显示 MCP 系统状态',
        '  /mcp install <name>    - 从市场安装 MCP 服务器（2026-08-06 新增）',
        '  /mcp run <action>      - 执行 MCP 工具动作',
        '  /mcp --json            - 以 JSON 格式输出',
        '  /mcp help              - 显示本帮助',
        '',
        '选项:',
        '  --json    以 JSON 格式输出结果',
        '',
        '服务器状态类型:',
        '  connected    - 已连接',
        '  failed       - 连接失败',
        '  disabled     - 已禁用',
        '  pending      - 等待连接',
        '  needs-auth   - 需要认证',
        '',
        '别名: /mcp-server, /mcp-manager',
      ].join('\n'),
    };
  },

  async showStatus(useJson: boolean) {
    const data = await collectMCPData();

    if (useJson) {
      return { success: true, message: JSON.stringify(data, null, 2) };
    }

    const lines: string[] = [];
    lines.push('MCP 系统状态');
    lines.push('=============');
    lines.push('');
    lines.push(`MCP 服务器总数: ${data.totalServers}`);
    lines.push(`已连接: ${data.connectedCount}`);
    lines.push(`连接失败: ${data.failedCount}`);
    lines.push(`已禁用: ${data.disabledCount}`);
    lines.push(`工具总数: ${data.totalTools}`);

    return { success: true, message: lines.join('\n') };
  },

  async listServers(useJson: boolean) {
    const data = await collectMCPData();

    if (useJson) {
      return { success: true, message: JSON.stringify(data, null, 2) };
    }

    if (data.servers.length === 0) {
      return {
        success: true,
        message:
          '当前没有注册的 MCP 服务器。\n提示: MCP 服务器由配置文件加载或在系统初始化时注册。',
      };
    }

    const lines: string[] = [];
    lines.push(`MCP 服务器列表 (共 ${data.servers.length} 个)`);
    lines.push('');

    for (const s of data.servers) {
      const icon =
        s.type === 'connected'
          ? '✅'
          : s.type === 'failed'
            ? '❌'
            : s.type === 'disabled'
              ? '⭕'
              : '🔄';
      lines.push(`  ${icon} ${s.name}`);
      lines.push(`     状态: ${s.status}`);
      lines.push(`     工具: ${s.toolsCount} 个`);
      if (s.error) {
        lines.push(`     错误: ${s.error}`);
      }
    }

    (await import('@modules/services/analytics/index.js')).logEvent(
      'tengu_mcp_list',
      {
        total: data.servers.length,
        connected: data.connectedCount,
      }
    );

    return { success: true, message: lines.join('\n') };
  },

  async listTools(useJson: boolean) {
    const data = await collectMCPData();

    if (useJson) {
      return { success: true, message: JSON.stringify(data, null, 2) };
    }

    if (data.totalTools === 0) {
      return { success: true, message: '当前没有可用的 MCP 工具。' };
    }

    const lines: string[] = [];
    lines.push(`MCP 工具列表 (共 ${data.totalTools} 个)`);
    lines.push('');

    for (const s of data.servers) {
      if (s.toolNames.length === 0) continue;
      lines.push(`  ${s.name} (${s.toolNames.length} 个工具):`);
      for (const toolName of s.toolNames) {
        lines.push(`    - ${toolName}`);
      }
    }

    (await import('@modules/services/analytics/index.js')).logEvent(
      'tengu_mcp_tools',
      {
        total: data.totalTools,
      }
    );

    return { success: true, message: lines.join('\n') };
  },

  async testConnections(useJson: boolean) {
    const data = await collectMCPData();

    const results = data.servers.map((s) => ({
      name: s.name,
      status: s.type === 'connected' ? '通过' : '失败',
      error: s.error || undefined,
    }));

    const passed = results.filter((r) => r.status === '通过').length;

    (await import('@modules/services/analytics/index.js')).logEvent(
      'tengu_mcp_test',
      {
        total: results.length,
        passed,
      }
    );

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(
          { results, total: results.length, passed },
          null,
          2
        ),
      };
    }

    const lines = results.map(
      (r) => `  ${r.status === '通过' ? '✅' : '❌'} ${r.name}: ${r.status}`
    );

    return {
      success: true,
      message: [
        'MCP 连接测试结果',
        '=================',
        '',
        `总计: ${results.length} | 通过: ${passed} | 失败: ${results.length - passed}`,
        '',
        ...lines,
      ].join('\n'),
    };
  },

  async runToolAction(args: string) {
    if (!args) {
      return {
        success: false,
        message: '请指定要执行的 MCP 操作。用法: /mcp run <操作名> [参数]',
      };
    }

    try {
      const { getToolManager } = await import('@modules/tools/ToolManager.js');
      const parts = args.trim().split(/\s+/);
      const action = parts[0];
      const params = parts.slice(1).join(' ');

      const toolManager = getToolManager();
      const result = await toolManager.executeTool(
        'mcp',
        { action, params },
        {}
      );

      return {
        success: true,
        message: result.output || 'MCP 操作已完成',
      };
    } catch (error) {
      return {
        success: false,
        message: `执行 MCP 操作失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

export default mcpCommand;
