/**
 * MCP协议解析和消息处理系统（基于CC源码实现）
 * 负责MCP协议的序列化、反序列化、验证和消息路由
 */

import type {
  MCPRequest,
  MCPResponse,
  MCPToolDefinition,
  MCPResourceDefinition,
  MCPPromptDefinition,
} from '../types/MCPTypes';

/**
 * MCP协议错误（基于CC源码）
 */
export class MCPProtocolError extends Error {
  constructor(
    message: string,
    public code: string,
    public data?: any
  ) {
    super(message);
    this.name = 'MCPProtocolError';
  }
}

/**
 * MCP协议验证器（基于CC源码）
 */
export class MCPProtocolValidator {
  /**
   * 验证请求（基于CC源码）
   */
  validateRequest(request: any): MCPRequest {
    if (typeof request !== 'object' || request === null) {
      throw new MCPProtocolError(
        'Request must be an object',
        'INVALID_REQUEST'
      );
    }

    if (typeof request.id !== 'string') {
      throw new MCPProtocolError(
        'Request must have an id',
        'MISSING_REQUEST_ID'
      );
    }

    if (typeof request.type !== 'string') {
      throw new MCPProtocolError(
        'Request must have a type',
        'MISSING_REQUEST_TYPE'
      );
    }

    // 验证特定类型的请求
    switch (request.type) {
      case 'call':
        this.validateCallRequest(request);
        break;
      case 'list_tools':
      case 'list_resources':
      case 'list_prompts':
      case 'ping':
        // 这些类型不需要额外验证
        break;
      default:
        throw new MCPProtocolError(
          `Unknown request type: ${request.type}`,
          'UNKNOWN_REQUEST_TYPE'
        );
    }

    return request as MCPRequest;
  }

  /**
   * 验证调用工具请求（基于CC源码）
   */
  private validateCallRequest(request: any): void {
    if (typeof request.tool_name !== 'string') {
      throw new MCPProtocolError(
        'Call request must have tool_name',
        'MISSING_TOOL_NAME'
      );
    }

    if (
      request.tool_arguments !== undefined &&
      typeof request.tool_arguments !== 'object'
    ) {
      throw new MCPProtocolError(
        'Tool arguments must be an object',
        'INVALID_TOOL_ARGUMENTS'
      );
    }
  }

  /**
   * 验证响应（基于CC源码）
   */
  validateResponse(response: any): MCPResponse {
    if (typeof response !== 'object' || response === null) {
      throw new MCPProtocolError(
        'Response must be an object',
        'INVALID_RESPONSE'
      );
    }

    if (typeof response.id !== 'string') {
      throw new MCPProtocolError(
        'Response must have an id',
        'MISSING_RESPONSE_ID'
      );
    }

    if (typeof response.request_id !== 'string') {
      throw new MCPProtocolError(
        'Response must have a request_id',
        'MISSING_REQUEST_ID'
      );
    }

    if (typeof response.type !== 'string') {
      throw new MCPProtocolError(
        'Response must have a type',
        'MISSING_RESPONSE_TYPE'
      );
    }

    // 验证特定类型的响应
    switch (response.type) {
      case 'result':
        // 结果响应可以有任何内容
        break;
      case 'error':
        this.validateErrorResponse(response);
        break;
      case 'progress':
        this.validateProgressResponse(response);
        break;
      default:
        throw new MCPProtocolError(
          `Unknown response type: ${response.type}`,
          'UNKNOWN_RESPONSE_TYPE'
        );
    }

    return response as MCPResponse;
  }

  /**
   * 验证错误响应（基于CC源码）
   */
  private validateErrorResponse(response: any): void {
    if (typeof response.error !== 'object' || response.error === null) {
      throw new MCPProtocolError(
        'Error response must have an error object',
        'MISSING_ERROR_OBJECT'
      );
    }

    if (typeof response.error.code !== 'string') {
      throw new MCPProtocolError(
        'Error must have a code',
        'MISSING_ERROR_CODE'
      );
    }

    if (typeof response.error.message !== 'string') {
      throw new MCPProtocolError(
        'Error must have a message',
        'MISSING_ERROR_MESSAGE'
      );
    }
  }

  /**
   * 验证进度响应（基于CC源码）
   */
  private validateProgressResponse(response: any): void {
    if (typeof response.progress !== 'object' || response.progress === null) {
      throw new MCPProtocolError(
        'Progress response must have a progress object',
        'MISSING_PROGRESS_OBJECT'
      );
    }

    if (typeof response.progress.progress !== 'number') {
      throw new MCPProtocolError(
        'Progress must have a progress number',
        'MISSING_PROGRESS_VALUE'
      );
    }

    if (typeof response.progress.total !== 'number') {
      throw new MCPProtocolError(
        'Progress must have a total number',
        'MISSING_TOTAL_VALUE'
      );
    }
  }

  /**
   * 验证工具定义（基于CC源码）
   */
  validateToolDefinition(tool: any): MCPToolDefinition {
    if (typeof tool !== 'object' || tool === null) {
      throw new MCPProtocolError('Tool must be an object', 'INVALID_TOOL');
    }

    if (typeof tool.name !== 'string') {
      throw new MCPProtocolError('Tool must have a name', 'MISSING_TOOL_NAME');
    }

    if (typeof tool.description !== 'string') {
      throw new MCPProtocolError(
        'Tool must have a description',
        'MISSING_TOOL_DESCRIPTION'
      );
    }

    if (typeof tool.inputSchema !== 'object' || tool.inputSchema === null) {
      throw new MCPProtocolError(
        'Tool must have an inputSchema',
        'MISSING_TOOL_INPUT_SCHEMA'
      );
    }

    return tool as MCPToolDefinition;
  }

  /**
   * 验证资源定义（基于CC源码）
   */
  validateResourceDefinition(resource: any): MCPResourceDefinition {
    if (typeof resource !== 'object' || resource === null) {
      throw new MCPProtocolError(
        'Resource must be an object',
        'INVALID_RESOURCE'
      );
    }

    if (typeof resource.id !== 'string') {
      throw new MCPProtocolError(
        'Resource must have an id',
        'MISSING_RESOURCE_ID'
      );
    }

    if (typeof resource.name !== 'string') {
      throw new MCPProtocolError(
        'Resource must have a name',
        'MISSING_RESOURCE_NAME'
      );
    }

    if (typeof resource.type !== 'string') {
      throw new MCPProtocolError(
        'Resource must have a type',
        'MISSING_RESOURCE_TYPE'
      );
    }

    if (typeof resource.uri !== 'string') {
      throw new MCPProtocolError(
        'Resource must have a uri',
        'MISSING_RESOURCE_URI'
      );
    }

    return resource as MCPResourceDefinition;
  }

  /**
   * 验证提示定义（基于CC源码）
   */
  validatePromptDefinition(prompt: any): MCPPromptDefinition {
    if (typeof prompt !== 'object' || prompt === null) {
      throw new MCPProtocolError('Prompt must be an object', 'INVALID_PROMPT');
    }

    if (typeof prompt.id !== 'string') {
      throw new MCPProtocolError('Prompt must have an id', 'MISSING_PROMPT_ID');
    }

    if (typeof prompt.name !== 'string') {
      throw new MCPProtocolError(
        'Prompt must have a name',
        'MISSING_PROMPT_NAME'
      );
    }

    if (typeof prompt.content !== 'string') {
      throw new MCPProtocolError(
        'Prompt must have content',
        'MISSING_PROMPT_CONTENT'
      );
    }

    return prompt as MCPPromptDefinition;
  }
}

/**
 * MCP消息序列化器（基于CC源码）
 */
export class MCPMessageSerializer {
  /**
   * 序列化请求（基于CC源码）
   */
  serializeRequest(request: MCPRequest): string {
    try {
      return JSON.stringify(request);
    } catch (error) {
      throw new MCPProtocolError(
        'Failed to serialize request',
        'SERIALIZATION_ERROR',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 序列化响应（基于CC源码）
   */
  serializeResponse(response: MCPResponse): string {
    try {
      return JSON.stringify(response);
    } catch (error) {
      throw new MCPProtocolError(
        'Failed to serialize response',
        'SERIALIZATION_ERROR',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 反序列化请求（基于CC源码）
   */
  deserializeRequest(data: string): MCPRequest {
    try {
      const parsed = JSON.parse(data);
      const validator = new MCPProtocolValidator();
      return validator.validateRequest(parsed);
    } catch (error) {
      if (error instanceof MCPProtocolError) {
        throw error;
      }
      throw new MCPProtocolError(
        'Failed to deserialize request',
        'DESERIALIZATION_ERROR',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 反序列化响应（基于CC源码）
   */
  deserializeResponse(data: string): MCPResponse {
    try {
      const parsed = JSON.parse(data);
      const validator = new MCPProtocolValidator();
      return validator.validateResponse(parsed);
    } catch (error) {
      if (error instanceof MCPProtocolError) {
        throw error;
      }
      throw new MCPProtocolError(
        'Failed to deserialize response',
        'DESERIALIZATION_ERROR',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }
}

/**
 * MCP消息路由器（基于CC源码）
 */
export class MCPMessageRouter {
  private handlers = new Map<string, (request: MCPRequest) => Promise<any>>();

  /**
   * 注册处理器（基于CC源码）
   */
  registerHandler(
    type: string,
    handler: (request: MCPRequest) => Promise<any>
  ): void {
    this.handlers.set(type, handler);
  }

  /**
   * 移除处理器（基于CC源码）
   */
  unregisterHandler(type: string): void {
    this.handlers.delete(type);
  }

  /**
   * 路由请求（基于CC源码）
   */
  async routeRequest(request: MCPRequest): Promise<any> {
    const handler = this.handlers.get(request.type);

    if (!handler) {
      throw new MCPProtocolError(
        `No handler registered for request type: ${request.type}`,
        'NO_HANDLER_FOUND'
      );
    }

    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof MCPProtocolError) {
        throw error;
      }

      throw new MCPProtocolError(
        'Handler execution failed',
        'HANDLER_EXECUTION_ERROR',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 创建错误响应（基于CC源码）
   */
  createErrorResponse(requestId: string, error: MCPProtocolError): MCPResponse {
    return {
      id: this.generateResponseId(),
      request_id: requestId,
      type: 'error',
      error: {
        code: error.code,
        message: error.message,
        data: error.data,
      },
    };
  }

  /**
   * 创建成功响应（基于CC源码）
   */
  createSuccessResponse(requestId: string, result: any): MCPResponse {
    return {
      id: this.generateResponseId(),
      request_id: requestId,
      type: 'result',
      result,
    };
  }

  /**
   * 创建进度响应（基于CC源码）
   */
  createProgressResponse(
    requestId: string,
    progress: number,
    total: number,
    message?: string
  ): MCPResponse {
    return {
      id: this.generateResponseId(),
      request_id: requestId,
      type: 'progress',
      progress: {
        progress,
        total,
        message,
      },
    };
  }

  /**
   * 生成响应ID（基于CC源码）
   */
  private generateResponseId(): string {
    return `resp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * MCP协议管理器（基于CC源码）
 */
export class MCPProtocolManager {
  private validator = new MCPProtocolValidator();
  private serializer = new MCPMessageSerializer();
  private router = new MCPMessageRouter();

  /**
   * 处理传入消息（基于CC源码）
   */
  async handleIncomingMessage(data: string): Promise<string> {
    try {
      // 反序列化请求
      const request = this.serializer.deserializeRequest(data);

      // 路由请求
      const result = await this.router.routeRequest(request);

      // 创建成功响应
      const response = this.router.createSuccessResponse(request.id, result);

      // 序列化响应
      return this.serializer.serializeResponse(response);
    } catch (error) {
      let requestId = 'unknown';

      try {
        // 尝试从原始数据中提取请求ID
        const parsed = JSON.parse(data);
        if (typeof parsed.id === 'string') {
          requestId = parsed.id;
        }
      } catch {
        // 忽略解析错误
      }

      // 创建错误响应
      const errorResponse = this.router.createErrorResponse(
        requestId,
        error instanceof MCPProtocolError
          ? error
          : new MCPProtocolError('Internal server error', 'INTERNAL_ERROR', {
              error: error instanceof Error ? error.message : String(error),
            })
      );

      // 序列化错误响应
      return this.serializer.serializeResponse(errorResponse);
    }
  }

  /**
   * 注册请求处理器（基于CC源码）
   */
  registerHandler(
    type: string,
    handler: (request: MCPRequest) => Promise<any>
  ): void {
    this.router.registerHandler(type, handler);
  }

  /**
   * 移除请求处理器（基于CC源码）
   */
  unregisterHandler(type: string): void {
    this.router.unregisterHandler(type);
  }

  /**
   * 验证请求（基于CC源码）
   */
  validateRequest(request: any): MCPRequest {
    return this.validator.validateRequest(request);
  }

  /**
   * 验证响应（基于CC源码）
   */
  validateResponse(response: any): MCPResponse {
    return this.validator.validateResponse(response);
  }

  /**
   * 序列化请求（基于CC源码）
   */
  serializeRequest(request: MCPRequest): string {
    return this.serializer.serializeRequest(request);
  }

  /**
   * 序列化响应（基于CC源码）
   */
  serializeResponse(response: MCPResponse): string {
    return this.serializer.serializeResponse(response);
  }

  /**
   * 反序列化请求（基于CC源码）
   */
  deserializeRequest(data: string): MCPRequest {
    return this.serializer.deserializeRequest(data);
  }

  /**
   * 反序列化响应（基于CC源码）
   */
  deserializeResponse(data: string): MCPResponse {
    return this.serializer.deserializeResponse(data);
  }
}

/**
 * 全局MCP协议管理器实例（基于CC源码）
 */
export const globalMCPProtocolManager = new MCPProtocolManager();

export default MCPProtocolManager;
