/**
 * MCP Elicit请求处理器
 * 负责处理MCP服务器的交互式用户输入请求
 * 参考CC源码 cc_code/backend/services/mcp/elicitationHandler.ts 实现
 */

import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
} from '@modelcontextprotocol/sdk/types.js';
import type { ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '@modules/utils/log';

/**
 * Elicit请求事件
 */
export interface ElicitationRequestEvent {
  serverName: string;
  requestId: string | number;
  params: ElicitRequestFormParams | ElicitRequestURLParams;
  signal: AbortSignal;
  respond: (response: ElicitResult) => void;
}

/**
 * Elicit响应类型
 */
export type ElicitResponseType = 'accept' | 'decline' | 'cancel';

/**
 * Elicit响应
 */
export interface MCPElicitResponse {
  action: ElicitResponseType;
  values?: Record<string, unknown>;
  message?: string;
}

/**
 * Elicit输入类型
 */
export type ElicitInputType = 'text' | 'select' | 'confirm' | 'url';

/**
 * Elicit选项（用于select类型）
 */
export interface ElicitOption {
  label: string;
  description?: string;
  value: string;
}

/**
 * Elicit等待状态
 */
export interface ElicitationWaitingState {
  actionLabel: string;
  showCancel?: boolean;
}

/**
 * Elicit处理器接口
 */
export interface MCPElicitHandler {
  onElicitRequest: (event: ElicitationRequestEvent) => void;
  onElicitResponse: (event: ElicitationRequestEvent, response: MCPElicitResponse) => void;
}

/**
 * Elicit请求队列
 */
export class MCPElicitationQueue {
  private queue: ElicitationRequestEvent[] = [];
  private handlers: MCPElicitHandler[] = [];

  /**
   * 添加处理器
   */
  addHandler(handler: MCPElicitHandler): void {
    this.handlers.push(handler);
  }

  /**
   * 移除处理器
   */
  removeHandler(handler: MCPElicitHandler): void {
    const index = this.handlers.indexOf(handler);
    if (index > -1) {
      this.handlers.splice(index, 1);
    }
  }

  /**
   * 入队请求
   */
  enqueue(event: ElicitationRequestEvent): void {
    this.queue.push(event);
    this.notifyHandlers('onElicitRequest', event);
  }

  /**
   * 出队请求
   */
  dequeue(requestId: string | number): ElicitationRequestEvent | undefined {
    const index = this.queue.findIndex(e => e.requestId === requestId);
    if (index > -1) {
      return this.queue.splice(index, 1)[0];
    }
    return undefined;
  }

  /**
   * 获取请求
   */
  get(requestId: string | number): ElicitationRequestEvent | undefined {
    return this.queue.find(e => e.requestId === requestId);
  }

  /**
   * 获取所有待处理请求
   */
  getAll(): ElicitationRequestEvent[] {
    return [...this.queue];
  }

  /**
   * 按服务器获取请求
   */
  getByServer(serverName: string): ElicitationRequestEvent[] {
    return this.queue.filter(e => e.serverName === serverName);
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * 通知处理器
   */
  private notifyHandlers(
    method: 'onElicitRequest' | 'onElicitResponse',
    event: ElicitationRequestEvent,
    response?: MCPElicitResponse
  ): void {
    for (const handler of this.handlers) {
      try {
        if (method === 'onElicitRequest') {
          handler.onElicitRequest(event);
        } else if (response) {
          handler.onElicitResponse(event, response);
        }
      } catch (error) {
        logger.error('Error notifying elicitation handler:', error);
      }
    }
  }
}

/**
 * Elicit工具调用参数
 */
export interface ElicitToolParams {
  serverName: string;
  requestId: string | number;
  action: ElicitResponseType;
  values?: Record<string, unknown>;
  message?: string;
}

/**
 * 构建Elicit响应
 */
export function buildElicitResponse(
  action: ElicitResponseType,
  values?: Record<string, unknown>,
  message?: string
): ElicitResult {
  const result: ElicitResult = {
    action,
  };

  if (values) {
    result.values = values;
  }

  if (message) {
    result.message = message;
  }

  return result;
}

/**
 * 从请求参数判断输入类型
 */
export function getElicitInputType(params: ElicitRequestFormParams | ElicitRequestURLParams): ElicitInputType {
  if (params.mode === 'url') {
    return 'url';
  }

  if ('requestedSchema' in params && params.requestedSchema) {
    const schema = params.requestedSchema;
    if (schema.type === 'object' && schema.properties) {
      const propValues = Object.values(schema.properties);
      if (propValues.some(p => 'enum' in (p as Record<string, unknown>))) {
        return 'select';
      }
    }
  }

  return 'text';
}

/**
 * 验证Elicit参数
 */
export function validateElicitParams(params: ElicitRequestFormParams | ElicitRequestURLParams): string[] {
  const errors: string[] = [];

  if (!params.message) {
    errors.push('Missing message');
  }

  return errors;
}

/**
 * 默认的Elicit处理器
 */
export class DefaultMCPElicitHandler implements MCPElicitHandler {
  private queue: MCPElicitationQueue;

  constructor(queue: MCPElicitationQueue) {
    this.queue = queue;
  }

  onElicitRequest(event: ElicitationRequestEvent): void {
    const errors = validateElicitParams(event.params);
    if (errors.length > 0) {
      logger.warn(`Invalid elicitation params: ${errors.join(', ')}`);
    }

    logger.debug(`Elicitation request from ${event.serverName}:`, event.params);
  }

  onElicitResponse(event: ElicitationRequestEvent, response: MCPElicitResponse): void {
    const result = buildElicitResponse(response.action, response.values, response.message);
    event.respond(result);
    this.queue.dequeue(event.requestId);
  }
}

/**
 * 导出单例队列
 */
export const mcpElicitationQueue = new MCPElicitationQueue();
