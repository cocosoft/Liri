/**
 * MCP CLI命令
 * 负责处理MCP相关的命令行操作
 */

import { Command } from 'commander';
import { configManager } from '@modules/config';
import { getMCPServerManager } from '@modules/services/mcp/MCPServerManager.js';
import { MCPServerConfig } from '../types';
import { readMcpConfig, writeMcpConfig } from '../utils/mcpConfig';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('mcpCommand');

import type { MCPOAuthConfig } from '@modules/services/mcp/auth/types.js';

/** 探测模式超时（毫秒） */
const PROBE_TIMEOUT_MS = 30_000;

/**
 * 从 MCPServerConfig 派生 MCPOAuthConfig。
 * 如果服务器配置中缺少 OAuth 信息则返回 null。
 */
function deriveOAuthConfig(config: MCPServerConfig): MCPOAuthConfig | null {
  if (!config.oauth?.clientId) return null;

  const metadataUrl = config.oauth.authServerMetadataUrl || config.url;
  if (!metadataUrl) return null;

  try {
    const baseUrl = new URL(metadataUrl);
    const origin = baseUrl.origin;

    return {
      clientId: config.oauth.clientId,
      authUrl: `${origin}/authorize`,
      tokenUrl: `${origin}/token`,
      redirectUri: `http://localhost:${config.oauth.callbackPort || 8205}/callback`,
    };
  } catch {
    return null;
  }
}

/**
 * 创建MCP CLI命令
 */
export function createMcpCommand(): Command {
  const mcpCommand = new Command('mcp');
  const serverManager = getMCPServerManager();
  const configPath =
    configManager.env('MCP_CONFIG_PATH') || './mcp.config.json';

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
          // @ignore-catch — CLI 命令失败，不预期抛出中断程序
          await handleError(error, {
            module: 'mcp:cli',
            action: 'serverConnect',
          });
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
        // @ignore-catch — CLI 命令失败，不预期抛出中断程序
        await handleError(error, {
          module: 'mcp:cli',
          action: 'serverDisconnect',
        });
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
          // @ignore-catch — CLI 命令失败，不预期抛出中断程序
          await handleError(error, { module: 'mcp:cli', action: 'toolList' });
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
        // @ignore-catch — CLI 命令失败，不预期抛出中断程序
        await handleError(error, { module: 'mcp:cli', action: 'toolCall' });
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

  // 探测命令（对标 hermes mcp test）
  mcpCommand
    .command('test <name>')
    .description(
      'Temporarily connect to an MCP server and list available tools (probe mode)'
    )
    .option('-t, --timeout <seconds>', 'Connection timeout in seconds', '30')
    .action(async (name, options) => {
      const servers = readMcpConfig(configPath);
      const config = servers[name];

      if (!config) {
        console.error(`Error: MCP server '${name}' not found in config.`);
        return;
      }

      const timeoutMs = parseInt(options.timeout) * 1000;
      console.log(
        `Probing MCP server '${name}' (timeout: ${options.timeout}s)...`
      );

      try {
        // 临时添加并连接
        const probeName = `_probe_${name}_${Date.now()}`;
        serverManager.addServer(probeName, config);

        const probePromise = serverManager.connectAll();
        const result = await Promise.race([
          probePromise.then(() => 'connected' as const),
          new Promise<'timeout'>((resolve) =>
            setTimeout(() => resolve('timeout'), timeoutMs)
          ),
        ]);

        if (result === 'timeout') {
          console.error(`Probe timed out after ${options.timeout}s.`);
          serverManager.removeServer(probeName);
          return;
        }

        const serverInfos = serverManager.getServerInfos();
        const serverInfo = serverInfos.find((s) => s.name === probeName);
        const tools = serverInfo?.tools || [];

        if (tools.length === 0) {
          console.log('No tools found on this server.');
        } else {
          console.log(`\nFound ${tools.length} tool(s):`);
          for (const tool of tools) {
            console.log(
              `  - ${tool.name}: ${tool.description || '(no description)'}`
            );
          }
        }

        // 清理探测连接
        await serverManager.removeServer(probeName);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Probe failed: ${msg}`);
        await handleError(error, { module: 'mcp:cli', action: 'probe' });
      }
    });

  // OAuth 登录命令（对标 hermes mcp login）
  mcpCommand
    .command('login <name>')
    .description('Force re-authenticate with an MCP server via OAuth')
    .action(async (name) => {
      const servers = readMcpConfig(configPath);
      const config = servers[name];

      if (!config) {
        console.error(`Error: MCP server '${name}' not found in config.`);
        return;
      }

      console.log(`Starting OAuth authentication for '${name}'...`);

      try {
        const oauthConfig = deriveOAuthConfig(config);
        if (!oauthConfig) {
          console.error(
            `Error: Server '${name}' does not have OAuth configuration. ` +
              'Add "oauth" section to the server config with at least clientId and authServerMetadataUrl.'
          );
          return;
        }

        // 使用 MCPAuthManager 发起 OAuth 流程（基于已归一的 OAuth 体系）
        const { mcpAuthManager } =
          await import('@modules/services/mcp/auth/MCPAuth.js');
        const result = await mcpAuthManager.initiateAuth(oauthConfig);
        console.log(
          `Please open the following URL in your browser:\n${result.authUrl}\n`
        );

        // 等待用户输入回调 URL
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const callbackUrl = await new Promise<string>((resolve) => {
          rl.question('Paste the callback URL here: ', (answer) => {
            rl.close();
            resolve(answer.trim());
          });
        });

        const parsedUrl = new URL(callbackUrl);
        const code = parsedUrl.searchParams.get('code');
        const state = parsedUrl.searchParams.get('state');

        if (!code) {
          console.error('Error: No authorization code found in callback URL.');
          return;
        }

        await mcpAuthManager.handleCallback(
          name,
          code,
          state || '',
          oauthConfig
        );
        console.log(`OAuth authentication completed for '${name}'.`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`OAuth login failed: ${msg}`);
        await handleError(error, { module: 'mcp:cli', action: 'oauthLogin' });
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
