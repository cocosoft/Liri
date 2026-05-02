/**
 * MCP工具注册表
 * 管理和注册所有可用的MCP工具
 */

import type { Tool } from '../tools/types';

export interface MCPToolInfo {
  name: string;
  server: string;
  description: string;
  inputSchema: Record<string, any>;
  tool: Tool;
}

export class MCPToolRegistry {
  private tools: Map<string, MCPToolInfo> = new Map();
  private serverTools: Map<string, Set<string>> = new Map();

  public registerTool(
    server: string,
    name: string,
    description: string,
    inputSchema: Record<string, any>,
    tool: Tool
  ): void {
    const toolInfo: MCPToolInfo = {
      name,
      server,
      description,
      inputSchema,
      tool,
    };

    this.tools.set(`${server}:${name}`, toolInfo);

    if (!this.serverTools.has(server)) {
      this.serverTools.set(server, new Set());
    }
    this.serverTools.get(server)!.add(name);
  }

  public getTool(server: string, name: string): MCPToolInfo | undefined {
    return this.tools.get(`${server}:${name}`);
  }

  public getToolByName(name: string): MCPToolInfo | undefined {
    for (const toolInfo of this.tools.values()) {
      if (toolInfo.name === name) {
        return toolInfo;
      }
    }
    return undefined;
  }

  public getAllTools(): MCPToolInfo[] {
    return Array.from(this.tools.values());
  }

  public getToolsByServer(server: string): MCPToolInfo[] {
    const serverToolNames = this.serverTools.get(server);
    if (!serverToolNames) {
      return [];
    }

    const tools: MCPToolInfo[] = [];
    for (const name of serverToolNames) {
      const toolInfo = this.tools.get(`${server}:${name}`);
      if (toolInfo) {
        tools.push(toolInfo);
      }
    }
    return tools;
  }

  public getServers(): string[] {
    return Array.from(this.serverTools.keys());
  }

  public getToolsByServerCount(): Map<string, number> {
    const countMap = new Map<string, number>();
    for (const [server, tools] of this.serverTools.entries()) {
      countMap.set(server, tools.size);
    }
    return countMap;
  }

  public unregisterTool(server: string, name: string): boolean {
    const key = `${server}:${name}`;
    const deleted = this.tools.delete(key);

    if (deleted) {
      const serverToolSet = this.serverTools.get(server);
      if (serverToolSet) {
        serverToolSet.delete(name);
        if (serverToolSet.size === 0) {
          this.serverTools.delete(server);
        }
      }
    }

    return deleted;
  }

  public unregisterServer(server: string): void {
    const toolNames = this.serverTools.get(server);
    if (toolNames) {
      for (const name of toolNames) {
        this.tools.delete(`${server}:${name}`);
      }
      this.serverTools.delete(server);
    }
  }

  public searchTools(query: string): MCPToolInfo[] {
    const results: MCPToolInfo[] = [];
    const lowerQuery = query.toLowerCase();

    for (const toolInfo of this.tools.values()) {
      if (
        toolInfo.name.toLowerCase().includes(lowerQuery) ||
        toolInfo.description.toLowerCase().includes(lowerQuery)
      ) {
        results.push(toolInfo);
      }
    }

    return results;
  }

  public getToolCount(): number {
    return this.tools.size;
  }

  public clear(): void {
    this.tools.clear();
    this.serverTools.clear();
  }
}

export const mcpToolRegistry = new MCPToolRegistry();
