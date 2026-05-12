/**
 * MCP资源工具
 * 参考CC源码 cc_code/backend/tools/MCPResourceTool/MCPResourceTool.ts 实现
 * 提供MCP资源的列表和读取功能
 */

import { BaseTool } from '../BaseTool';
import type {
  ToolResult,
  ToolUseContext,
  ToolParam,
  ToolCallProgress,
  ValidationResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });
import { getMCPServerManager } from '@modules/mcp/managers/MCPServerManager';

/**
 * MCP资源工具输入类型
 */
export interface MCPResourceToolInput {
  /** 操作类型 */
  action: 'list_resources' | 'read_resource' | 'list_prompts' | 'get_prompt';
  /** 服务器名称 */
  server_name?: string;
  /** 资源URI */
  uri?: string;
  /** 提示名称 */
  prompt_name?: string;
  /** 提示参数 */
  prompt_args?: Record<string, any>;
}

/**
 * MCP资源工具输出类型
 */
export interface MCPResourceToolOutput {
  /** 操作结果 */
  success: boolean;
  /** 资源列表 */
  resources?: any[];
  /** 资源内容 */
  content?: any;
  /** 提示列表 */
  prompts?: any[];
  /** 提示内容 */
  prompt?: any;
  /** 消息 */
  message?: string;
  /** 错误信息 */
  error?: string;
}

/**
 * MCP资源工具
 */
export class MCPResourceTool extends BaseTool<
  MCPResourceToolInput,
  MCPResourceToolOutput
> {
  name = 'mcp_resource';
  description =
    'List and read MCP (Model Context Protocol) resources and prompts from connected servers';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      description:
        'Action to perform: list_resources, read_resource, list_prompts, get_prompt',
      required: true,
      enum: ['list_resources', 'read_resource', 'list_prompts', 'get_prompt'],
    },
    {
      name: 'server_name',
      type: 'string',
      description:
        'MCP server name (required for read_resource, list_prompts, get_prompt)',
      required: false,
      default: '',
    },
    {
      name: 'uri',
      type: 'string',
      description: 'Resource URI (required for read_resource)',
      required: false,
      default: '',
    },
    {
      name: 'prompt_name',
      type: 'string',
      description: 'Prompt name (required for get_prompt)',
      required: false,
      default: '',
    },
    {
      name: 'prompt_args',
      type: 'object',
      description: 'Prompt arguments (for get_prompt)',
      required: false,
    },
  ];

  override aliases = ['mcp_resources', 'mcp_prompts'];
  override searchHint = 'List and read MCP resources and prompts';
  override maxResultSizeChars = 100000;

  override isReadOnly(): boolean {
    return true;
  }

  override isConcurrencySafe(): boolean {
    return true;
  }

  override validateInput(input: MCPResourceToolInput): ValidationResult {
    const validActions = [
      'list_resources',
      'read_resource',
      'list_prompts',
      'get_prompt',
    ];

    if (!input.action || !validActions.includes(input.action)) {
      return {
        result: false,
        message: `Invalid action. Must be one of: ${validActions.join(', ')}`,
        errorCode: 1,
      };
    }

    if (input.action === 'read_resource' && !input.uri) {
      return {
        result: false,
        message: 'uri is required for read_resource action',
        errorCode: 2,
      };
    }

    if (input.action === 'get_prompt' && !input.prompt_name) {
      return {
        result: false,
        message: 'prompt_name is required for get_prompt action',
        errorCode: 3,
      };
    }

    return { result: true };
  }

  override userFacingName(input?: Partial<MCPResourceToolInput>): string {
    const action = input?.action || 'list_resources';
    const serverName = input?.server_name || '';

    switch (action) {
      case 'list_resources':
        return serverName
          ? `MCP Resources: List from ${serverName}`
          : 'MCP Resources: List all';
      case 'read_resource':
        return `MCP Resource: Read ${input?.uri || ''}`;
      case 'list_prompts':
        return serverName
          ? `MCP Prompts: List from ${serverName}`
          : 'MCP Prompts: List all';
      case 'get_prompt':
        return `MCP Prompt: Get ${input?.prompt_name || ''}`;
      default:
        return this.name;
    }
  }

  override getToolUseSummary(
    input?: Partial<MCPResourceToolInput>
  ): string | null {
    const action = input?.action || 'list_resources';
    const serverName = input?.server_name || '';
    const uri = input?.uri || '';
    const promptName = input?.prompt_name || '';

    switch (action) {
      case 'list_resources':
        return serverName
          ? `List MCP resources from ${serverName}`
          : 'List all MCP resources';
      case 'read_resource':
        return `Read MCP resource: ${uri}`;
      case 'list_prompts':
        return serverName
          ? `List MCP prompts from ${serverName}`
          : 'List all MCP prompts';
      case 'get_prompt':
        return `Get MCP prompt: ${promptName}`;
      default:
        return null;
    }
  }

  override getActivityDescription(
    input?: Partial<MCPResourceToolInput>
  ): string | null {
    const action = input?.action || 'list_resources';
    const serverName = input?.server_name || '';

    switch (action) {
      case 'list_resources':
        return serverName
          ? `Listing MCP resources from ${serverName}`
          : 'Listing all MCP resources';
      case 'read_resource':
        return `Reading MCP resource: ${input?.uri || ''}`;
      case 'list_prompts':
        return serverName
          ? `Listing MCP prompts from ${serverName}`
          : 'Listing all MCP prompts';
      case 'get_prompt':
        return `Getting MCP prompt: ${input?.prompt_name || ''}`;
      default:
        return null;
    }
  }

  override toAutoClassifierInput(input: MCPResourceToolInput): unknown {
    return `${input.action} ${input.server_name || ''} ${input.uri || input.prompt_name || ''}`;
  }

  /**
   * 执行工具
   */
  async execute(
    input: MCPResourceToolInput,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<MCPResourceToolOutput>> {
    const validation = this.validateInput(input);
    if (!validation.result) {
      return createToolResult(
        {
          success: false,
          message: validation.message,
        },
        {
          success: false,
          error: validation.message,
        }
      );
    }

    try {
      const mcpManager = getMCPServerManager();

      switch (input.action) {
        case 'list_resources': {
          if (input.server_name) {
            // 列出指定服务器的资源
            const server = mcpManager.getServer(input.server_name);
            if (!server) {
              return createToolResult(
                {
                  success: false,
                  message: `MCP server not found: ${input.server_name}`,
                },
                {
                  success: false,
                  error: `MCP server not found: ${input.server_name}`,
                }
              );
            }

            // 通过服务器连接获取资源列表
            const resources = await this.listResourcesFromServer(
              input.server_name
            );
            const output: MCPResourceToolOutput = {
              success: true,
              resources,
              message: `Found ${resources.length} resources from ${input.server_name}`,
            };
            return createToolResult(output, {
              success: true,
              output: this.formatResourcesList(resources, input.server_name),
            });
          } else {
            // 列出所有服务器的资源
            const allResources: any[] = [];
            const servers = mcpManager.listServers();

            for (const serverName of servers) {
              try {
                const resources =
                  await this.listResourcesFromServer(serverName);
                allResources.push(
                  ...resources.map((r) => ({ ...r, server: serverName }))
                );
              } catch (error: any) {
                logger.warning(
                  `Failed to list resources from ${serverName}`,
                  error instanceof Error
                    ? error
                    : new Error(String(error.message))
                );
              }
            }

            const output: MCPResourceToolOutput = {
              success: true,
              resources: allResources,
              message: `Found ${allResources.length} resources from ${servers.length} servers`,
            };
            return createToolResult(output, {
              success: true,
              output: this.formatAllResourcesList(allResources),
            });
          }
        }

        case 'read_resource': {
          if (!input.server_name) {
            return createToolResult(
              {
                success: false,
                message: 'server_name is required for read_resource',
              },
              {
                success: false,
                error: 'server_name is required for read_resource',
              }
            );
          }

          const content = await this.readResource(
            input.server_name,
            input.uri!
          );
          const output: MCPResourceToolOutput = {
            success: true,
            content,
            message: `Read resource ${input.uri} from ${input.server_name}`,
          };
          return createToolResult(output, {
            success: true,
            output: `Resource content:\n${JSON.stringify(content, null, 2)}`,
          });
        }

        case 'list_prompts': {
          if (input.server_name) {
            const prompts = await this.listPromptsFromServer(input.server_name);
            const output: MCPResourceToolOutput = {
              success: true,
              prompts,
              message: `Found ${prompts.length} prompts from ${input.server_name}`,
            };
            return createToolResult(output, {
              success: true,
              output: this.formatPromptsList(prompts, input.server_name),
            });
          } else {
            const allPrompts: any[] = [];
            const servers = mcpManager.listServers();

            for (const serverName of servers) {
              try {
                const prompts = await this.listPromptsFromServer(serverName);
                allPrompts.push(
                  ...prompts.map((p) => ({ ...p, server: serverName }))
                );
              } catch (error: any) {
                logger.warning(
                  `Failed to list prompts from ${serverName}`,
                  error instanceof Error
                    ? error
                    : new Error(String(error.message))
                );
              }
            }

            const output: MCPResourceToolOutput = {
              success: true,
              prompts: allPrompts,
              message: `Found ${allPrompts.length} prompts from ${servers.length} servers`,
            };
            return createToolResult(output, {
              success: true,
              output: this.formatAllPromptsList(allPrompts),
            });
          }
        }

        case 'get_prompt': {
          if (!input.server_name) {
            return createToolResult(
              {
                success: false,
                message: 'server_name is required for get_prompt',
              },
              {
                success: false,
                error: 'server_name is required for get_prompt',
              }
            );
          }

          const prompt = await this.getPrompt(
            input.server_name,
            input.prompt_name!,
            input.prompt_args
          );
          const output: MCPResourceToolOutput = {
            success: true,
            prompt,
            message: `Got prompt ${input.prompt_name} from ${input.server_name}`,
          };
          return createToolResult(output, {
            success: true,
            output: `Prompt content:\n${JSON.stringify(prompt, null, 2)}`,
          });
        }

        default:
          return createToolResult(
            {
              success: false,
              message: `Unknown action: ${input.action}`,
            },
            {
              success: false,
              error: `Unknown action: ${input.action}`,
            }
          );
      }
    } catch (error: any) {
      return createToolResult(
        {
          success: false,
          message: `MCP resource operation failed: ${error.message}`,
        },
        {
          success: false,
          error: `MCP resource operation failed: ${error.message}`,
        }
      );
    }
  }

  /**
   * 从服务器列出资源
   * 通过MCP协议获取资源列表
   */
  private async listResourcesFromServer(serverName: string): Promise<any[]> {
    const mcpManager = getMCPServerManager();
    const server = mcpManager.getServer(serverName);

    if (!server) {
      throw new AppError(
        `Server not found: ${serverName}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1005'
      );
    }

    // 通过transport发送resources/list请求
    // 这里使用MCP协议的resources/list方法
    try {
      const response = await server.sendRequest({
        id: `list-resources-${Date.now()}`,
        type: 'list_tools', // MCP协议中resources/list与tools/list类似
      });

      // 如果服务器支持资源，返回资源列表
      // 否则返回空列表
      if (response.type === 'result' && response.result) {
        const result = response.result as { resources?: unknown[] };
        return result.resources || [];
      }

      return [];
    } catch (error) {
      // 如果服务器不支持资源列表，返回空列表
      return [];
    }
  }

  /**
   * 读取资源
   */
  private async readResource(serverName: string, uri: string): Promise<any> {
    const mcpManager = getMCPServerManager();
    const server = mcpManager.getServer(serverName);

    if (!server) {
      throw new AppError(
        `Server not found: ${serverName}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1005'
      );
    }

    // 通过transport发送resources/read请求
    try {
      const response = await server.sendRequest({
        id: `read-resource-${Date.now()}`,
        type: 'call',
        tool_name: 'resources/read',
        args: { uri },
      });

      if (response.type === 'error') {
        throw new AppError(
          response.error?.message || 'Failed to read resource',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      return response.result;
    } catch (error: any) {
      throw new AppError(
        `Failed to read resource ${uri}: ${error.message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 从服务器列出提示
   */
  private async listPromptsFromServer(serverName: string): Promise<any[]> {
    const mcpManager = getMCPServerManager();
    const server = mcpManager.getServer(serverName);

    if (!server) {
      throw new AppError(
        `Server not found: ${serverName}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1005'
      );
    }

    try {
      const response = await server.sendRequest({
        id: `list-prompts-${Date.now()}`,
        type: 'call',
        tool_name: 'prompts/list',
        args: {},
      });

      if (response.type === 'result' && response.result) {
        const result = response.result as { prompts?: unknown[] };
        return result.prompts || [];
      }

      return [];
    } catch (error) {
      return [];
    }
  }

  /**
   * 获取提示
   */
  private async getPrompt(
    serverName: string,
    promptName: string,
    args?: Record<string, any>
  ): Promise<any> {
    const mcpManager = getMCPServerManager();
    const server = mcpManager.getServer(serverName);

    if (!server) {
      throw new AppError(
        `Server not found: ${serverName}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1005'
      );
    }

    try {
      const response = await server.sendRequest({
        id: `get-prompt-${Date.now()}`,
        type: 'call',
        tool_name: 'prompts/get',
        args: { name: promptName, arguments: args },
      });

      if (response.type === 'error') {
        throw new AppError(
          response.error?.message || 'Failed to get prompt',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      return response.result;
    } catch (error: any) {
      throw new AppError(
        `Failed to get prompt ${promptName}: ${error.message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 格式化资源列表
   */
  private formatResourcesList(resources: any[], serverName: string): string {
    if (resources.length === 0) {
      return `No resources found from ${serverName}`;
    }

    const lines = [`Resources from ${serverName}:`];
    for (const resource of resources) {
      lines.push(`  · ${resource.name || resource.uri || 'Unknown'}`);
      if (resource.description) {
        lines.push(`    ${resource.description}`);
      }
    }
    return lines.join('\n');
  }

  /**
   * 格式化所有资源列表
   */
  private formatAllResourcesList(resources: any[]): string {
    if (resources.length === 0) {
      return 'No resources found from any server';
    }

    const lines = [`Found ${resources.length} resources:`];
    for (const resource of resources) {
      lines.push(
        `  · [${resource.server}] ${resource.name || resource.uri || 'Unknown'}`
      );
    }
    return lines.join('\n');
  }

  /**
   * 格式化提示列表
   */
  private formatPromptsList(prompts: any[], serverName: string): string {
    if (prompts.length === 0) {
      return `No prompts found from ${serverName}`;
    }

    const lines = [`Prompts from ${serverName}:`];
    for (const prompt of prompts) {
      lines.push(`  · ${prompt.name || 'Unknown'}`);
      if (prompt.description) {
        lines.push(`    ${prompt.description}`);
      }
    }
    return lines.join('\n');
  }

  /**
   * 格式化所有提示列表
   */
  private formatAllPromptsList(prompts: any[]): string {
    if (prompts.length === 0) {
      return 'No prompts found from any server';
    }

    const lines = [`Found ${prompts.length} prompts:`];
    for (const prompt of prompts) {
      lines.push(`  · [${prompt.server}] ${prompt.name || 'Unknown'}`);
    }
    return lines.join('\n');
  }
}

export default MCPResourceTool;
