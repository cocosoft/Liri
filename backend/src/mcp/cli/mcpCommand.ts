/**
 * MCP CLI命令
 * 负责处理MCP相关的命令行操作
 */

import { Command } from 'commander';
import { getMCPServerManager } from '../managers/MCPServerManager';
import { MCPServerConfig } from '../types';
import { readMcpConfig, writeMcpConfig } from '../utils/mcpConfig';

/**
 * 创建MCP CLI命令
 */
export function createMcpCommand(): Command {
  const mcpCommand = new Command('mcp');
  const serverManager = getMCPServerManager();
  const configPath = process.env.MCP_CONFIG_PATH || './mcp.config.json';

  mcpCommand
    .description('Manage MCP (Model Context Protocol) servers and tools')
    .version('1.0.0');

  // 服务器管理命令
  const serverCommand = new Command('server');
  serverCommand.description('Manage MCP servers').version('1.0.0');

  // 列出服务器
  serverCommand
    .command('list')
    .description('List all MCP servers')
    .action(() => {
      const servers = readMcpConfig(configPath);
      console.log('MCP Servers:');
      for (const [name, config] of Object.entries(servers)) {
        console.log(`- ${name} (${config.type || 'stdio'})`);
      }
    });

  // 添加服务器
  serverCommand
    .command('add <name>')
    .description('Add a new MCP server')
    .option('-t, --type <type>', 'Server type (stdio, sse, ws, http)', 'stdio')
    .option('-c, --command <command>', 'Command for stdio server')
    .option('-u, --url <url>', 'URL for remote server')
    .action((name, options) => {
      const servers = readMcpConfig(configPath);

      const serverConfig: MCPServerConfig = {
        type: options.type,
      };

      if (options.type === 'stdio' && options.command) {
        serverConfig.command = options.command;
      } else if (['sse', 'ws', 'http'].includes(options.type) && options.url) {
        serverConfig.url = options.url;
      }

      servers[name] = serverConfig;
      writeMcpConfig(configPath, servers);
      console.log(`Added MCP server: ${name}`);
    });

  // 删除服务器
  serverCommand
    .command('remove <name>')
    .description('Remove an MCP server')
    .action((name) => {
      const servers = readMcpConfig(configPath);
      if (servers[name]) {
        delete servers[name];
        writeMcpConfig(configPath, servers);
        console.log(`Removed MCP server: ${name}`);
      } else {
        console.log(`MCP server not found: ${name}`);
      }
    });

  // 连接服务器
  serverCommand
    .command('connect <name>')
    .description('Connect to an MCP server')
    .action(async (name) => {
      const servers = readMcpConfig(configPath);
      const config = servers[name];

      if (config) {
        try {
          serverManager.addServer(name, config);
          await serverManager.connectAll();
          console.log(`Connected to MCP server: ${name}`);
        } catch (error) {
          console.error(`Failed to connect to MCP server: ${error}`);
        }
      } else {
        console.log(`MCP server not found: ${name}`);
      }
    });

  // 断开服务器
  serverCommand
    .command('disconnect <name>')
    .description('Disconnect from an MCP server')
    .action(async (name) => {
      try {
        serverManager.removeServer(name);
        console.log(`Disconnected from MCP server: ${name}`);
      } catch (error) {
        console.error(`Failed to disconnect from MCP server: ${error}`);
      }
    });

  mcpCommand.addCommand(serverCommand);

  // 工具管理命令
  const toolCommand = new Command('tool');
  toolCommand.description('Manage MCP tools').version('1.0.0');

  // 列出工具
  toolCommand
    .command('list [server]')
    .description('List tools available from MCP servers')
    .action(async (server) => {
      if (server) {
        try {
          const serverInfo = await serverManager.getServerTools(server);
          console.log(`Tools from server ${server}:`);
          for (const tool of serverInfo.tools) {
            console.log(`- ${tool.name}: ${tool.description}`);
          }
        } catch (error) {
          console.error(`Failed to get tools from server: ${error}`);
        }
      } else {
        const serverInfos = serverManager.getServerInfos();
        console.log('All MCP tools:');
        for (const serverInfo of serverInfos) {
          console.log(`\nServer: ${serverInfo.name}`);
          for (const tool of serverInfo.tools) {
            console.log(`- ${tool.name}: ${tool.description}`);
          }
        }
      }
    });

  // 调用工具
  toolCommand
    .command('call <server> <tool>')
    .description('Call a tool from an MCP server')
    .option('-a, --args <args>', 'Tool arguments as JSON string', '{}')
    .action(async (server, tool, options) => {
      try {
        const args = JSON.parse(options.args);
        const result = await serverManager.callTool(server, tool, args);
        console.log('Tool call result:');
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.error(`Failed to call tool: ${error}`);
      }
    });

  mcpCommand.addCommand(toolCommand);

  // 状态命令
  mcpCommand
    .command('status')
    .description('Show MCP system status')
    .action(() => {
      const servers = readMcpConfig(configPath);
      const allServers = serverManager.listServers();

      console.log('MCP System Status:');
      console.log('==================');
      console.log(`Config path: ${configPath}`);
      console.log(`Total servers: ${Object.keys(servers).length}`);
      console.log(`Registered servers: ${allServers.length}`);

      if (allServers.length > 0) {
        console.log('\nRegistered servers:');
        for (const server of allServers) {
          console.log(`- ${server}`);
        }
      }
    });

  return mcpCommand;
}

/**
 * 执行MCP CLI命令
 */
export async function executeMcpCommand(args: string[]): Promise<void> {
  const mcpCommand = createMcpCommand();
  await mcpCommand.parseAsync(args);
}
