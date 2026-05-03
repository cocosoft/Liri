/**
 * 桥接权限管理器
 * 处理桥接权限请求的转发和响应
 */

import type { PermissionUpdate } from './utils/permissions/PermissionUpdateSchema.js';

/**
 * 桥接权限响应
 */
export interface BridgePermissionResponse {
  behavior: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
  updatedPermissions?: PermissionUpdate[];
  message?: string;
}

/**
 * 桥接权限回调
 */
export interface BridgePermissionCallbacks {
  sendRequest(
    requestId: string,
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string,
    description: string,
    permissionSuggestions?: PermissionUpdate[],
    blockedPath?: string,
  ): void;
  sendResponse(requestId: string, response: BridgePermissionResponse): void;
  cancelRequest(requestId: string): void;
  onResponse(
    requestId: string,
    handler: (response: BridgePermissionResponse) => void,
  ): () => void;
}

/**
 * 权限请求
 */
export interface PermissionRequest {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  description: string;
  permissionSuggestions?: PermissionUpdate[];
  blockedPath?: string;
  timestamp: number;
  handler?: (response: BridgePermissionResponse) => void;
}

/**
 * 桥接权限管理器选项
 */
export interface BridgePermissionManagerOptions {
  /** 权限请求超时时间（毫秒） */
  timeoutMs?: number;
  /** 最大并发请求数 */
  maxConcurrentRequests?: number;
  /** 发送权限请求的回调 */
  onSendRequest?: (request: PermissionRequest) => void;
  /** 接收权限响应的回调 */
  onReceiveResponse?: (requestId: string, response: BridgePermissionResponse) => void;
}

/**
 * 桥接权限管理器
 */
export class BridgePermissionManager implements BridgePermissionCallbacks {
  private options: BridgePermissionManagerOptions;
  private pendingRequests: Map<string, PermissionRequest>;
  private responseHandlers: Map<string, Set<(response: BridgePermissionResponse) => void>>;

  constructor(options: BridgePermissionManagerOptions = {}) {
    this.options = {
      timeoutMs: 30000, // 默认30秒超时
      maxConcurrentRequests: 10,
      ...options,
    };
    this.pendingRequests = new Map();
    this.responseHandlers = new Map();
  }

  /**
   * 发送权限请求
   */
  sendRequest(
    requestId: string,
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string,
    description: string,
    permissionSuggestions?: PermissionUpdate[],
    blockedPath?: string,
  ): void {
    // 检查并发限制
    if (this.pendingRequests.size >= this.options.maxConcurrentRequests!) {
      console.warn('[bridge] Max concurrent permission requests reached');
      return;
    }

    const request: PermissionRequest = {
      requestId,
      toolName,
      input,
      toolUseId,
      description,
      permissionSuggestions,
      blockedPath,
      timestamp: Date.now(),
    };

    this.pendingRequests.set(requestId, request);

    // 设置超时
    setTimeout(() => {
      if (this.pendingRequests.has(requestId)) {
        console.warn(`[bridge] Permission request timed out: ${requestId}`);
        this.pendingRequests.delete(requestId);
        this.notifyHandlers(requestId, {
          behavior: 'deny',
          message: 'Permission request timed out',
        });
      }
    }, this.options.timeoutMs);

    // 通知发送回调
    this.options.onSendRequest?.(request);

    console.log(`[bridge] Sent permission request: ${requestId} for tool ${toolName}`);
  }

  /**
   * 发送权限响应
   */
  sendResponse(requestId: string, response: BridgePermissionResponse): void {
    if (!this.pendingRequests.has(requestId)) {
      console.warn(`[bridge] Received response for unknown request: ${requestId}`);
      return;
    }

    // 移除待处理请求
    this.pendingRequests.delete(requestId);

    // 通知处理程序
    this.notifyHandlers(requestId, response);

    // 通知接收回调
    this.options.onReceiveResponse?.(requestId, response);

    console.log(`[bridge] Sent permission response: ${requestId} - ${response.behavior}`);
  }

  /**
   * 取消权限请求
   */
  cancelRequest(requestId: string): void {
    if (this.pendingRequests.has(requestId)) {
      this.pendingRequests.delete(requestId);
      this.notifyHandlers(requestId, {
        behavior: 'deny',
        message: 'Permission request cancelled',
      });
      console.log(`[bridge] Cancelled permission request: ${requestId}`);
    }
  }

  /**
   * 注册响应处理程序
   */
  onResponse(
    requestId: string,
    handler: (response: BridgePermissionResponse) => void,
  ): () => void {
    if (!this.responseHandlers.has(requestId)) {
      this.responseHandlers.set(requestId, new Set());
    }

    const handlers = this.responseHandlers.get(requestId)!;
    handlers.add(handler);

    // 返回取消订阅函数
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.responseHandlers.delete(requestId);
      }
    };
  }

  /**
   * 通知处理程序
   */
  private notifyHandlers(requestId: string, response: BridgePermissionResponse): void {
    const handlers = this.responseHandlers.get(requestId);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(response);
        } catch (error) {
          console.error('[bridge] Error in permission response handler:', error);
        }
      });
      this.responseHandlers.delete(requestId);
    }
  }

  /**
   * 获取待处理请求数量
   */
  getPendingRequestsCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * 清空所有待处理请求
   */
  clearPendingRequests(): void {
    this.pendingRequests.forEach((request, requestId) => {
      this.notifyHandlers(requestId, {
        behavior: 'deny',
        message: 'Permission request cleared',
      });
    });
    this.pendingRequests.clear();
    this.responseHandlers.clear();
  }

  /**
   * 检查请求是否存在
   */
  hasRequest(requestId: string): boolean {
    return this.pendingRequests.has(requestId);
  }

  /**
   * 获取请求信息
   */
  getRequest(requestId: string): PermissionRequest | undefined {
    return this.pendingRequests.get(requestId);
  }
}

/**
 * 验证桥接权限响应
 */
export function isBridgePermissionResponse(
  value: unknown,
): value is BridgePermissionResponse {
  if (!value || typeof value !== 'object') return false;
  return (
    'behavior' in value &&
    ((value as any).behavior === 'allow' || (value as any).behavior === 'deny')
  );
}
