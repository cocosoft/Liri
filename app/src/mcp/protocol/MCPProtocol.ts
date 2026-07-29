/**
 * 负责MCP协议的序列化、反序列化、验证和消息路由
 */

import type {
  MCPRequest,
  MCPResponse,
  MCPToolDefinition,
  MCPResourceDefinition,
  MCPPromptDefinition,
} from '../types/MCPTypes';

import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'mcp:protocol:MCPProtocol',
  level: LogLevel.INFO,
});

/**
 * MCP协议错误
 */
export class MCPProtocolError extends AppError {
  constructor(
    message: string,
    public override code: string,
    public data?: unknown
  ) {
    super(message, ErrorCategory.OPERATION, ErrorSeverity.MEDIUM, code);
    this.name = 'MCPProtocolError';
  }
}

/**
 * MCP协议验证器
 */
export class MCPProtocolValidator {
  /**
   * 验证请求
   */
  validateRequest(request: unknown): MCPRequest {
    const req = request as Record<string, unknown>;
    if (typeof request !== 'object' || request === null) {
      throw new MCPProtocolError(
        'Request must be an object',
        'INVALID_REQUEST'
      );
    }

    if (typeof req.id !== 'string') {
      throw new MCPProtocolError(
        'Request must have an id',
        'MISSING_REQUEST_ID'
      );
    }

    if (typeof req.type !== 'string') {
      throw new MCPProtocolError(
        'Request must have a type',
        'MISSING_REQUEST_TYPE'
      );
    }

    // 验证特定类型的请求
    switch (req.type) {
      case 'call':
        this.validateCallRequest(req);
        break;
      case 'list_tools':
      case 'list_resources':
      case 'list_prompts':
      case 'ping':
        // 这些类型不需要额外验证
        break;
      default:
        throw new MCPProtocolError(
          `Unknown request type: ${req.type}`,
          'UNKNOWN_REQUEST_TYPE'
        );
    }

    return request as MCPRequest;
  }

  /**
   * 验证调用工具请求
   */
  private validateCallRequest(request: Record<string, unknown>): void {
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
   * 验证响应
   */
  validateResponse(response: unknown): MCPResponse {
    const resp = response as Record<string, unknown>;
    if (typeof response !== 'object' || response === null) {
      throw new MCPProtocolError(
        'Response must be an object',
        'INVALID_RESPONSE'
      );
    }

    if (typeof resp.id !== 'string') {
      throw new MCPProtocolError(
        'Response must have an id',
        'MISSING_RESPONSE_ID'
      );
    }

    if (typeof resp.request_id !== 'string') {
      throw new MCPProtocolError(
        'Response must have a request_id',
        'MISSING_REQUEST_ID'
      );
    }

    if (typeof resp.type !== 'string') {
      throw new MCPProtocolError(
        'Response must have a type',
        'MISSING_RESPONSE_TYPE'
      );
    }

    // 验证特定类型的响应
    switch (resp.type) {
      case 'result':
        // 结果响应可以有任何内容
        break;
      case 'error':
        this.validateErrorResponse(resp);
        break;
      case 'progress':
        this.validateProgressResponse(resp);
        break;
      default:
        throw new MCPProtocolError(
          `Unknown response type: ${resp.type}`,
          'UNKNOWN_RESPONSE_TYPE'
        );
    }

    return response as MCPResponse;
  }

  /**
   * 验证错误响应
   */
  private validateErrorResponse(response: Record<string, unknown>): void {
    if (typeof response.error !== 'object' || response.error === null) {
      throw new MCPProtocolError(
        'Error response must have an error object',
        'MISSING_ERROR_OBJECT'
      );
    }

    const err = response.error as Record<string, unknown>;
    if (typeof err.code !== 'string') {
      throw new MCPProtocolError(
        'Error must have a code',
        'MISSING_ERROR_CODE'
      );
    }

    if (typeof err.message !== 'string') {
      throw new MCPProtocolError(
        'Error must have a message',
        'MISSING_ERROR_MESSAGE'
      );
    }
  }

  /**
   * 验证进度响应
   */
  private validateProgressResponse(response: Record<string, unknown>): void {
    if (typeof response.progress !== 'object' || response.progress === null) {
      throw new MCPProtocolError(
        'Progress response must have a progress object',
        'MISSING_PROGRESS_OBJECT'
      );
    }

    const progress = response.progress as Record<string, unknown>;
    if (typeof progress.progress !== 'number') {
      throw new MCPProtocolError(
        'Progress must have a progress number',
        'MISSING_PROGRESS_VALUE'
      );
    }

    if (typeof progress.total !== 'number') {
      throw new MCPProtocolError(
        'Progress must have a total number',
        'MISSING_TOTAL_VALUE'
      );
    }
  }

  /**
   * 验证工具定义
   */
  validateToolDefinition(tool: unknown): MCPToolDefinition {
    const t = tool as Record<string, unknown>;
    if (typeof tool !== 'object' || tool === null) {
      throw new MCPProtocolError('Tool must be an object', 'INVALID_TOOL');
    }

    if (typeof t.name !== 'string') {
      throw new MCPProtocolError('Tool must have a name', 'MISSING_TOOL_NAME');
    }

    if (typeof t.description !== 'string') {
      throw new MCPProtocolError(
        'Tool must have a description',
        'MISSING_TOOL_DESCRIPTION'
      );
    }

    if (typeof t.inputSchema !== 'object' || t.inputSchema === null) {
      throw new MCPProtocolError(
        'Tool must have an inputSchema',
        'MISSING_TOOL_INPUT_SCHEMA'
      );
    }

    return tool as MCPToolDefinition;
  }

  /**
   * 验证资源定义
   */
  validateResourceDefinition(resource: unknown): MCPResourceDefinition {
    const res = resource as Record<string, unknown>;
    if (typeof resource !== 'object' || resource === null) {
      throw new MCPProtocolError(
        'Resource must be an object',
        'INVALID_RESOURCE'
      );
    }

    if (typeof res.id !== 'string') {
      throw new MCPProtocolError(
        'Resource must have an id',
        'MISSING_RESOURCE_ID'
      );
    }

    if (typeof res.name !== 'string') {
      throw new MCPProtocolError(
        'Resource must have a name',
        'MISSING_RESOURCE_NAME'
      );
    }

    if (typeof res.type !== 'string') {
      throw new MCPProtocolError(
        'Resource must have a type',
        'MISSING_RESOURCE_TYPE'
      );
    }

    if (typeof res.uri !== 'string') {
      throw new MCPProtocolError(
        'Resource must have a uri',
        'MISSING_RESOURCE_URI'
      );
    }

    return resource as MCPResourceDefinition;
  }

  /**
   * 验证提示定义
   */
  validatePromptDefinition(prompt: unknown): MCPPromptDefinition {
    const p = prompt as Record<string, unknown>;
    if (typeof prompt !== 'object' || prompt === null) {
      throw new MCPProtocolError('Prompt must be an object', 'INVALID_PROMPT');
    }

    if (typeof p.id !== 'string') {
      throw new MCPProtocolError('Prompt must have an id', 'MISSING_PROMPT_ID');
    }

    if (typeof p.name !== 'string') {
      throw new MCPProtocolError(
        'Prompt must have a name',
        'MISSING_PROMPT_NAME'
      );
    }

    if (typeof p.content !== 'string') {
      throw new MCPProtocolError(
        'Prompt must have content',
        'MISSING_PROMPT_CONTENT'
      );
    }

    return prompt as MCPPromptDefinition;
  }
}

/**
 * MCP消息序列化器
 */
export class MCPMessageSerializer {
  /**
   * 序列化请求
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
   * 序列化响应
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
   * 反序列化请求
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
   * 反序列化响应
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
 * MCP消息路由器
 */
export class MCPMessageRouter {
  private handlers = new Map<
    string,
    (request: MCPRequest) => Promise<unknown>
  >();

  /**
   * 注册处理器
   */
  registerHandler(
    type: string,
    handler: (request: MCPRequest) => Promise<unknown>
  ): void {
    this.handlers.set(type, handler);
  }

  /**
   * 移除处理器
   */
  unregisterHandler(type: string): void {
    this.handlers.delete(type);
  }

  /**
   * 路由请求
   */
  async routeRequest(request: MCPRequest): Promise<unknown> {
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
   * 创建错误响应
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
   * 创建成功响应
   */
  createSuccessResponse(requestId: string, result: unknown): MCPResponse {
    return {
      id: this.generateResponseId(),
      request_id: requestId,
      type: 'result',
      result,
    };
  }

  /**
   * 创建进度响应
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
   * 生成响应ID
   */
  private generateResponseId(): string {
    return `resp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * MCP协议管理器
 */
export class MCPProtocolManager {
  private validator = new MCPProtocolValidator();
  private serializer = new MCPMessageSerializer();
  private router = new MCPMessageRouter();

  /**
   * 处理传入消息
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
      } catch (err) {
        // 忽略解析错误

        handleError(err, {
          module: 'mcp:protocol',
          action: 'extractRequestId',
        });
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
   * 注册请求处理器
   */
  registerHandler(
    type: string,
    handler: (request: MCPRequest) => Promise<unknown>
  ): void {
    this.router.registerHandler(type, handler);
  }

  /**
   * 移除请求处理器
   */
  unregisterHandler(type: string): void {
    this.router.unregisterHandler(type);
  }

  /**
   * 验证请求
   */
  validateRequest(request: unknown): MCPRequest {
    return this.validator.validateRequest(request);
  }

  /**
   * 验证响应
   */
  validateResponse(response: unknown): MCPResponse {
    return this.validator.validateResponse(response);
  }

  /**
   * 序列化请求
   */
  serializeRequest(request: MCPRequest): string {
    return this.serializer.serializeRequest(request);
  }

  /**
   * 序列化响应
   */
  serializeResponse(response: MCPResponse): string {
    return this.serializer.serializeResponse(response);
  }

  /**
   * 反序列化请求
   */
  deserializeRequest(data: string): MCPRequest {
    return this.serializer.deserializeRequest(data);
  }

  /**
   * 反序列化响应
   */
  deserializeResponse(data: string): MCPResponse {
    return this.serializer.deserializeResponse(data);
  }
}

/**
 * 全局MCP协议管理器实例
 */
export const globalMCPProtocolManager = new MCPProtocolManager();

export default MCPProtocolManager;
