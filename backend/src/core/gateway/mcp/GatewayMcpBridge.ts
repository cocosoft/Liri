/**
 * GatewayMcpBridge 网关 MCP 桥接器
 * 将已有 MCP 服务集成到网关，使 WebSocket 客户端可通过网关访问 MCP 工具
 */
import { EventEmitter } from 'node:events';

/**
 * MCP 工具定义
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP 调用请求
 */
export interface McpCallRequest {
  tool: string;
  args: Record<string, unknown>;
  requestId?: string;
}

/**
 * MCP 调用响应
 */
export interface McpCallResponse {
  success: boolean;
  requestId?: string;
  data?: unknown;
  error?: string;
}

/**
 * 网关 MCP 桥接器
 */
export class GatewayMcpBridge extends EventEmitter {
  private tools: Map<string, McpToolDefinition> = new Map();
  private handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>> = new Map();

  /**
   * 注册 MCP 工具
   */
  registerTool(
    definition: McpToolDefinition,
    handler: (args: Record<string, unknown>) => Promise<unknown>
  ): void {
    this.tools.set(definition.name, definition);
    this.handlers.set(definition.name, handler);

    this.emit('tool:registered', definition);
  }

  /**
   * 批量注册工具
   */
  registerTools(
    tools: Array<{ definition: McpToolDefinition; handler: (args: Record<string, unknown>) => Promise<unknown> }>
  ): void {
    for (const { definition, handler } of tools) {
      this.registerTool(definition, handler);
    }
  }

  /**
   * 注销工具
   */
  unregisterTool(name: string): boolean {
    const removed = this.tools.delete(name);

    this.handlers.delete(name);

    if (removed) {
      this.emit('tool:unregistered', name);
    }

    return removed;
  }

  /**
   * 获取工具列表
   */
  listTools(): McpToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 调用 MCP 工具
   */
  async callTool(request: McpCallRequest): Promise<McpCallResponse> {
    const handler = this.handlers.get(request.tool);

    if (!handler) {
      return {
        success: false,
        requestId: request.requestId,
        error: `工具 ${request.tool} 未注册`,
      };
    }

    try {
      this.emit('tool:beforeCall', { tool: request.tool, args: request.args });

      const data = await handler(request.args);

      this.emit('tool:afterCall', { tool: request.tool, success: true });

      return {
        success: true,
        requestId: request.requestId,
        data,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);

      this.emit('tool:afterCall', { tool: request.tool, success: false, error });

      return {
        success: false,
        requestId: request.requestId,
        error,
      };
    }
  }

  /**
   * 批量调用
   */
  async callTools(requests: McpCallRequest[]): Promise<McpCallResponse[]> {
    return Promise.all(requests.map((req) => this.callTool(req)));
  }

  /**
   * 获取已注册工具数量
   */
  getToolCount(): number {
    return this.tools.size;
  }

  /**
   * 获取工具是否存在
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取所有工具名称
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }
}

export const gatewayMcpBridge = new GatewayMcpBridge();
