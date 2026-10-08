/**
 * MCP资源工具
 * 提供MCP资源的列表和读取功能
 */

import { BaseTool } from '../BaseTool';
import { ToolTag } from '../types/Tool';
import type {
  ToolResult,
  ToolUseContext,
  ToolParam,
  ToolCallProgress,
  ToolProgressData,
  ValidationResult,
} from '../types';
import { createToolResult } from '../types/ToolResult';
import { getLogger } from '@modules/monitoring';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';

const logger = getLogger('tools:mcpResource');
// 2026-10-08（MCP 双轨收敛 C-1）：本工具的 4 个操作由**自研 `MCPServerManager` 链**
// 改走**已连接的 SDK `Client`** —— 与 `mcp__*` 主路径（`MCPToolBridge`/`McpToolWrapper`）**同一条链**。
// 取客户端统一走 `mcpConnectionManager.getSdkClient()`（单一入口，见该方法注释）。
import { mcpConnectionManager } from '@modules/services/mcp/MCPConnectionManager.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpResourcesDriver, type VfsEntry } from '@modules/vfs';
import { MCPResourceOutputSchema } from './schemas';

/**
 * MCP 资源驱动实例（**惰性单例**）。
 *
 * 2026-10-08（MCP 双轨收敛 C-1 续）：`list_resources` / `read_resource` 的**实现归属翻转**
 * 到 VFS 驱动 `McpResourcesDriver`（它是 `mcp://` 面的**单一实现**，二者不再各写一份协议投影）。
 * 此处**直接实例化**（**不**走 `vfsMountRegistry`）—— 避免对 entrypoint 装配序产生硬依赖。
 * `list_prompts` / `get_prompt` 仍直连 SDK（本次不涉及）。
 *
 * 2026-10-08（**P0 修复**）：原为**模块作用域** `new McpResourcesDriver()` ⇒ 本模块在**环中
 * 被求值**时读取该绑定，触发 **ESM TDZ**：`Cannot access 'McpResourcesDriver' before initialization`。
 * 环 = `@modules/vfs` 桶（再导出驱动）→ `McpResourcesDriver` → `services/mcp/MCPConnectionManager`
 * → …服务图… → **本模块** →（原）桶 ⇒ 冷启动首个 `import('@modules/vfs')`（即
 * `entrypoints/vfsWiring.registerVfsMounts()` 的**生产装配路径**）**直接抛错** ⇒ **全部 VFS
 * 挂载点注册不上**（实测：冷进程探针必现；测试因加载序不同而掩盖）。
 * 惰性化后**求值期不再读该绑定**（调用期读取时类已初始化），并省去 import 期构造开销 ——
 * 这是**唯一必要**的修复（**不**改走叶入口：`R03-002`「模块出口单一」禁止子目录直连，
 * 且**调用期**从桶取值本就安全）。
 */
let mcpResourcesDriverInstance: McpResourcesDriver | undefined;

/** 取驱动单例（首次调用时构造） */
function mcpResourcesDriver(): McpResourcesDriver {
  mcpResourcesDriverInstance ??= new McpResourcesDriver();
  return mcpResourcesDriverInstance;
}

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
  prompt_args?: Record<string, unknown>;
}

/**
 * MCP资源工具输出类型
 */
export interface MCPResourceToolOutput {
  /** 操作结果 */
  success: boolean;
  /** 资源列表 */
  resources?: unknown[];
  /** 资源内容 */
  content?: unknown;
  /** 提示列表 */
  prompts?: unknown[];
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

  /**
   * 出参契约（P1-3 A 档；2026-09-29 **T6 批次 4a 接线**）。
   *
   * 该 schema **早已存在却零消费者**。实测成功出口均为 `MCPResourceToolOutput` 对象
   * （`{success: true, resources|content|prompts|prompt, message}`）⇒ 全在 schema 的
   * **1 必填 + 6 可选**字段之内；失败分支在 **ToolResult 层自带 `success: false`** ⇒ 命中豁免、不参与校验。
   */
  outputSchema = MCPResourceOutputSchema;
  description =
    '列出并读取已连接 MCP（Model Context Protocol）服务器的资源和提示词';
  override tags = [ToolTag.NETWORK];

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      description:
        '要执行的操作：list_resources、read_resource、list_prompts、get_prompt',
      required: true,
      enum: ['list_resources', 'read_resource', 'list_prompts', 'get_prompt'],
    },
    {
      name: 'server_name',
      type: 'string',
      description:
        'MCP 服务器名称（read_resource、list_prompts、get_prompt 操作需要）',
      required: false,
      default: '',
    },
    {
      name: 'uri',
      type: 'string',
      description: '资源 URI（read_resource 操作需要）',
      required: false,
      default: '',
    },
    {
      name: 'prompt_name',
      type: 'string',
      description: '提示词名称（get_prompt 操作需要）',
      required: false,
      default: '',
    },
    {
      name: 'prompt_args',
      type: 'object',
      description: '提示词参数（get_prompt 操作使用）',
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
  override async execute(
    input: MCPResourceToolInput,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<ToolProgressData>
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
      switch (input.action) {
        case 'list_resources': {
          if (input.server_name) {
            // 列出指定服务器的资源（未连接 ⇒ `listResourcesFromServer` 如实抛错）
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
            const allResources: unknown[] = [];
            const servers = this.connectedServerNames();

            for (const serverName of servers) {
              try {
                const resources =
                  await this.listResourcesFromServer(serverName);
                allResources.push(
                  ...resources.map((r) => ({
                    ...(r as Record<string, unknown>),
                    server: serverName,
                  }))
                );
              } catch (error: unknown) {
                void handleError(error, {
                  module: 'tools:mcpResource',
                  action: 'listResources',
                });
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
            const allPrompts: unknown[] = [];
            const servers = this.connectedServerNames();

            for (const serverName of servers) {
              try {
                const prompts = await this.listPromptsFromServer(serverName);
                allPrompts.push(
                  ...prompts.map((p) => ({
                    ...(p as Record<string, unknown>),
                    server: serverName,
                  }))
                );
              } catch (error: unknown) {
                void handleError(error, {
                  module: 'tools:mcpResource',
                  action: 'listPrompts',
                });
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
    } catch (error: unknown) {
      return createToolResult(
        {
          success: false,
          message: `MCP resource operation failed: ${error instanceof Error ? error.message : String(error)}`,
        },
        {
          success: false,
          error: `MCP resource operation failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      );
    }
  }

  /**
   * 取该服务器**已连接的 SDK `Client`**；未连接 ⇒ 抛出**如实**错误（CS03：不静默降级）。
   *
   * 单一入口 = `mcpConnectionManager.getSdkClient()`（本仓"取 SDK 客户端"的**唯一判据处**，
   * 见其注释：只有 `clientCache` 中 `type === 'connected'` 的条目才有 SDK Client）。
   */
  private requireSdkClient(serverName: string): Client {
    const client = mcpConnectionManager.getSdkClient(serverName);
    if (!client) {
      throw new AppError(
        `MCP server not connected: ${serverName}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'MCP_SERVER_NOT_CONNECTED'
      );
    }
    return client;
  }

  /** 已连接（SDK）的服务器名 —— "列出全部"分支用（不硬编码某一条链的注册表） */
  private connectedServerNames(): string[] {
    const names = mcpConnectionManager
      .getServers()
      .filter((s) => s.type === 'connected')
      .map((s) => s.name);
    return [...new Set(names)];
  }

  /**
   * 从服务器列出资源（**经 VFS 驱动 `McpResourcesDriver`**，`mcp://` 面的单一实现）。
   *
   * 2026-10-08（C-1 续）：**实现归属翻转** —— 原直连 SDK `listResources()`，现改调驱动
   * `list({ scheme:'mcp', authority:serverName, path:'' })` 取 `VfsEntry[]`，再**映射回
   * 工具既有资源条目形状**（`uri`/`name`/`description`/`mimeType` ⇒ 下游
   * `formatResourcesList` / `formatAllResourcesList` 与结构化 `resources` 出参语义不变）。
   * ⚠️ 驱动以资源 **uri 原文**作为 `entry.name`（见其文件头"路径映射"注释）。
   * 驱动在服务器未连接 / SDK 报错时抛 `AppError` ⇒ 由上层 catch 如实落到结果 `error`（不静默降级）。
   */
  private async listResourcesFromServer(
    serverName: string
  ): Promise<unknown[]> {
    const entries = await mcpResourcesDriver().list(
      { scheme: 'mcp', authority: serverName, path: '' },
      { recursive: false, limit: 200 }
    );
    return entries.map((entry) => this.resourceFromEntry(entry));
  }

  /**
   * `VfsEntry` → 工具既有资源条目形状（等价 SDK `Resource`：`uri`/`name`/`description`/`mimeType`）。
   * 缺省字段（`description`/`mimeType`）**省略**，与"源未提供"保持一致（不编造，CS04）。
   */
  private resourceFromEntry(entry: VfsEntry): Record<string, unknown> {
    return {
      uri: entry.name,
      name: entry.name,
      ...(entry.description ? { description: entry.description } : {}),
      ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
    };
  }

  /**
   * 读取资源（**经 VFS 驱动 `McpResourcesDriver`**，`mcp://` 面的单一实现）。
   *
   * 2026-10-08（C-1 续）：**实现归属翻转** —— 原直连 SDK `readResource({ uri })`，现改调驱动
   * `read({ scheme:'mcp', authority:serverName, path:uri })`，用返回的 `{ data, mimeType }`
   * **重建工具既有输出形状** `{ contents: [{ uri, mimeType, text }] }`（`case 'read_resource'`
   * 分支的 `content` 字段形状与 `output` 文案均不变）。驱动报错 ⇒ `AppError` 上抛，由上层
   * catch 如实落到结果 `error`（不静默降级）。
   */
  private async readResource(
    serverName: string,
    uri: string
  ): Promise<unknown> {
    const result = await mcpResourcesDriver().read({
      scheme: 'mcp',
      authority: serverName,
      path: uri,
    });
    return {
      contents: [{ uri, mimeType: result.mimeType, text: result.data }],
    };
  }

  /**
   * 从服务器列出提示（**SDK 标准方法 `listPrompts()`**）。
   *
   * 2026-10-08 两轮修复：① 原把协议方法 `prompts/list` 当作 `tool_name` 发 `type:'call'`；
   * ② C-1 收敛后改走 SDK 顶层方法，不再手写协议请求。同时保持"不静默吞错"（CS03）。
   */
  private async listPromptsFromServer(serverName: string): Promise<unknown[]> {
    const { prompts } = await this.requireSdkClient(serverName).listPrompts();
    return prompts as unknown[];
  }

  /**
   * 获取提示（**SDK 标准方法 `getPrompt()`**）。
   *
   * 2026-10-08（C-1）：原把协议方法 `prompts/get` 当作 `tool_name` 发 `type:'call'`
   * （自研链 `MCPRequest` 联合**没有** `get_prompt` 类型）⇒ 现改走 SDK 标准方法。
   */
  private async getPrompt(
    serverName: string,
    promptName: string,
    args?: Record<string, unknown>
  ): Promise<unknown> {
    return await this.requireSdkClient(serverName).getPrompt({
      name: promptName,
      // SDK 声明 prompt 参数为 `Record<string, string>`（协议层即字符串）；本工具入参是
      // `Record<string, unknown>`（模型可传任意 JSON）⇒ 此处为**类型层对齐**，**运行期不改写**
      // 任何值（不把数字/布尔静默转字符串 —— 由服务器按协议自行校验）。
      arguments: args as Record<string, string> | undefined,
    });
  }

  /**
   * 格式化资源列表
   */
  private formatResourcesList(
    resources: unknown[],
    serverName: string
  ): string {
    if (resources.length === 0) {
      return `No resources found from ${serverName}`;
    }

    const lines = [`Resources from ${serverName}:`];
    for (const item of resources) {
      const resource = item as Record<string, unknown>;
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
  private formatAllResourcesList(resources: unknown[]): string {
    if (resources.length === 0) {
      return 'No resources found from any server';
    }

    const lines = [`Found ${resources.length} resources:`];
    for (const item of resources) {
      const resource = item as Record<string, unknown>;
      lines.push(
        `  · [${resource.server}] ${resource.name || resource.uri || 'Unknown'}`
      );
    }
    return lines.join('\n');
  }

  /**
   * 格式化提示列表
   */
  private formatPromptsList(prompts: unknown[], serverName: string): string {
    if (prompts.length === 0) {
      return `No prompts found from ${serverName}`;
    }

    const lines = [`Prompts from ${serverName}:`];
    for (const item of prompts) {
      const prompt = item as Record<string, unknown>;
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
  private formatAllPromptsList(prompts: unknown[]): string {
    if (prompts.length === 0) {
      return 'No prompts found from any server';
    }

    const lines = [`Found ${prompts.length} prompts:`];
    for (const item of prompts) {
      const prompt = item as Record<string, unknown>;
      lines.push(`  · [${prompt.server}] ${prompt.name || 'Unknown'}`);
    }
    return lines.join('\n');
  }
}

export default MCPResourceTool;
