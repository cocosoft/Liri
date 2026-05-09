/**
 * 权限同步
 */
import { PermissionRequest, PermissionResponse } from '../SubAgentCommunicator';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 权限同步
 */
export class PermissionSync {
  private permissionCache: Map<string, PermissionResponse> = new Map();
  private pendingRequests: Map<string, PermissionRequest> = new Map();

  /**
   * 发送权限请求
   * @param request 权限请求
   * @returns 请求ID
   */
  sendPermissionRequest(request: PermissionRequest): string {
    // 生成请求ID
    const requestId = request.id || `perm_req_${Date.now()}`;

    // 检查缓存
    const cacheKey = this.generateCacheKey(request);
    const cachedResponse = this.permissionCache.get(cacheKey);
    if (cachedResponse) {
      logger.info(`Permission request ${requestId} cached:`, {
        cachedResponse,
      });
      return requestId;
    }

    // 保存请求
    this.pendingRequests.set(requestId, request);
    logger.info(`Permission request sent:`, { request });

    return requestId;
  }

  /**
   * 接收权限响应
   * @param response 权限响应
   */
  receivePermissionResponse(response: PermissionResponse): void {
    // 获取请求
    const request = this.pendingRequests.get(response.requestId);
    if (request) {
      // 保存到缓存
      const cacheKey = this.generateCacheKey(request);
      this.permissionCache.set(cacheKey, response);

      // 移除待处理请求
      this.pendingRequests.delete(response.requestId);

      logger.info(`Permission response received:`, { response });
    }
  }

  /**
   * 获取权限响应
   * @param requestId 请求ID
   * @returns 权限响应
   */
  getPermissionResponse(requestId: string): PermissionResponse | undefined {
    // 检查待处理请求
    const request = this.pendingRequests.get(requestId);
    if (request) {
      // 检查缓存
      const cacheKey = this.generateCacheKey(request);
      return this.permissionCache.get(cacheKey);
    }

    return undefined;
  }

  /**
   * 检查权限
   * @param request 权限请求
   * @returns 权限响应
   */
  checkPermission(request: PermissionRequest): PermissionResponse | undefined {
    // 检查缓存
    const cacheKey = this.generateCacheKey(request);
    return this.permissionCache.get(cacheKey);
  }

  /**
   * 生成缓存键
   * @param request 权限请求
   * @returns 缓存键
   */
  private generateCacheKey(request: PermissionRequest): string {
    return `${request.type}:${request.resource}:${request.action}`;
  }

  /**
   * 清除权限缓存
   */
  clearCache(): void {
    this.permissionCache.clear();
    logger.info('Permission cache cleared');
  }

  /**
   * 清除待处理请求
   */
  clearPendingRequests(): void {
    this.pendingRequests.clear();
    logger.info('Pending permission requests cleared');
  }

  /**
   * 获取待处理请求数量
   * @returns 待处理请求数量
   */
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * 获取缓存大小
   * @returns 缓存大小
   */
  getCacheSize(): number {
    return this.permissionCache.size;
  }

  /**
   * 清理所有资源
   */
  cleanup(): void {
    this.clearCache();
    this.clearPendingRequests();
    logger.info('PermissionSync cleaned up');
  }
}

/**
 * 创建权限同步
 * @returns 权限同步实例
 */
export function createPermissionSync(): PermissionSync {
  return new PermissionSync();
}
