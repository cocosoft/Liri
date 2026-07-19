/**
 * MCP Provider
 * 集成 MCP 系统到 Mini Agent
 * 简化版本 - 不直接依赖 MCP 模块
 */

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'ai:localAgent:MCPProvider',
  level: LogLevel.INFO,
});

export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  success: boolean;
  output?: string;
  error?: string;
  toolCall?: MCPToolCall;
}

export interface MCPProviderConfig {
  enabled: boolean;
  mcpClient?: IMCPClient;
}

export interface IMCPClient {
  callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPToolResult>;
  listTools(): Promise<string[]>;
  isConnected(): boolean;
}

export class MCPProvider {
  private client: IMCPClient | null = null;
  private enabled: boolean = false;

  constructor(config: MCPProviderConfig) {
    this.enabled = config.enabled;
    this.client = config.mcpClient || null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setClient(client: IMCPClient): void {
    this.client = client;
  }

  getClient(): IMCPClient | null {
    return this.client;
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    if (!this.enabled) {
      return {
        success: false,
        error: 'MCP provider is disabled',
      };
    }

    if (!this.client) {
      return {
        success: false,
        error: 'MCP client not available',
      };
    }

    try {
      return await this.client.callTool(toolName, args);
    } catch (error) {
      return {
        success: false,
        error: `MCP tool call error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async listTools(): Promise<string[]> {
    if (!this.enabled || !this.client) {
      return [];
    }

    try {
      return await this.client.listTools();
    } catch (error) {
      return [];
    }
  }

  isConnected(): boolean {
    return this.client?.isConnected() || false;
  }

  async matchTool(input: string): Promise<string | null> {
    if (!this.enabled || !this.client) {
      return null;
    }

    const lowerInput = input.toLowerCase();

    const tools = await this.listTools();
    for (const tool of tools) {
      if (lowerInput.includes(tool.toLowerCase())) {
        return tool;
      }
    }

    const commonTools = [
      'filesystem',
      'git',
      'bash',
      'shell',
      'search',
      'web',
      'http',
      'api',
      'database',
      'sql',
    ];

    for (const tool of commonTools) {
      if (lowerInput.includes(tool)) {
        return tool;
      }
    }

    return null;
  }
}

let globalMCPProvider: MCPProvider | null = null;

export function getGlobalMCPProvider(): MCPProvider {
  if (!globalMCPProvider) {
    globalMCPProvider = new MCPProvider({ enabled: false });
  }
  return globalMCPProvider;
}

export function createMCPProvider(config?: MCPProviderConfig): MCPProvider {
  return new MCPProvider(config || { enabled: false });
}
