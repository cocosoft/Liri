//
/**
 * MCP工具包装器
 * 将MCP服务器提供的序列化工具数据包装为符合Tool接口的实例
 */

import type { Tool, ToolInfo, ToolParam } from '@modules/tools/types/Tool';
import type { ToolUseContext } from '@modules/tools/types/ToolUseContext';
import type { ToolResult } from '@modules/tools/types/ToolResult';
import type { SerializedTool } from './types';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

/**
 * MCP工具包装器
 * 实现Tool接口，代理对远程MCP工具的调用
 */
export class McpToolWrapper implements Tool {
  name: string;
  description: string;
  params: ToolParam[] = [];
  aliases?: string[];
  searchHint?: string;
  isMcp = true;
  mcpInfo: { serverName: string; toolName: string };
  inputJSONSchema?: any;

  private serverName: string;
  private toolName: string;
  private getClient: () => Client | undefined;

  constructor(
    serverName: string,
    toolData: SerializedTool,
    getClient: () => Client | undefined
  ) {
    this.serverName = serverName;
    this.toolName = toolData.originalToolName || toolData.name;
    this.name = `${serverName}__${this.toolName}`;
    this.description = toolData.description || `MCP tool from ${serverName}`;
    this.inputJSONSchema = toolData.inputJSONSchema;
    this.mcpInfo = { serverName, toolName: this.toolName };
    this.aliases = [this.toolName];
    this.searchHint = `MCP tool from ${serverName}`;
    this.getClient = getClient;

    if (toolData.inputJSONSchema?.properties) {
      this.params = Object.entries(toolData.inputJSONSchema.properties).map(
        ([name, prop]: [string, any]) => ({
          name,
          type: prop.type || 'string',
          description: prop.description || '',
          required:
            ((toolData.inputJSONSchema?.required as string[]) || []).includes(
              name
            ) || false,
        })
      );
    }
  }

  isEnabled(): boolean {
    return true;
  }

  isReadOnly(_input?: Record<string, unknown>): boolean {
    return true;
  }

  isDestructive(_input?: Record<string, unknown>): boolean {
    return false;
  }

  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  async execute(
    input: any,
    _context: ToolUseContext,
    _onProgress?: any
  ): Promise<ToolResult> {
    const client = this.getClient();
    if (!client) {
      return {
        success: false,
        error: `MCP server "${this.serverName}" is not connected`,
        status: 'failure' as any,
      };
    }

    try {
      const result = await (client as any).tools.call({
        name: this.toolName,
        arguments: input,
      });

      const content = result.content as
        | Array<{ type: string; text?: string; data?: any }>
        | undefined;
      const textContent =
        content
          ?.map((c) => c.text)
          .filter(Boolean)
          .join('\n') || '';

      return {
        success: !result.isError,
        output: textContent,
        data: result,
        status: result.isError ? ('failure' as any) : ('success' as any),
        mcpMeta: result._meta ? { _meta: result._meta } : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: `MCP tool call failed: ${error instanceof Error ? error.message : String(error)}`,
        status: 'failure' as any,
      };
    }
  }

  getInfo(): ToolInfo {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      enabled: true,
      readOnly: true,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'cancel',
      aliases: this.aliases,
      searchHint: this.searchHint,
    };
  }
}
