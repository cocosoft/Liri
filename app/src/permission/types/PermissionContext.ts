/**
 * 权限上下文接口
 */
export interface PermissionContext {
  /**
   * 会话ID（可选）
   */
  sessionId?: string;

  /**
   * 用户ID（可选）
   */
  userId?: string;

  /**
   * 工具名称
   */
  toolName: string;

  /**
   * 用户角色（可选）
   */
  userRole?: string;

  /**
   * 客户端IP（可选）
   */
  clientIp?: string;

  /**
   * 工具输入
   */
  input: Record<string, unknown>;

  /**
   * 元数据（可选）
   */
  metadata?: Record<string, unknown>;
}

/**
 * 创建权限上下文
 * @param params 上下文参数
 * @returns 权限上下文对象
 */
export function createPermissionContext(params: {
  toolName: string;
  input: Record<string, unknown>;
  sessionId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}): PermissionContext {
  return {
    sessionId: params.sessionId,
    userId: params.userId,
    toolName: params.toolName,
    input: params.input,
    metadata: params.metadata,
  };
}

/**
 * 扩展权限上下文
 * @param context 原始上下文
 * @param extensions 扩展内容
 * @returns 扩展后的上下文
 */
export function extendPermissionContext(
  context: PermissionContext,
  extensions: Partial<PermissionContext>
): PermissionContext {
  return {
    ...context,
    ...extensions,
    input: {
      ...context.input,
      ...(extensions.input || {}),
    },
    metadata: {
      ...context.metadata,
      ...(extensions.metadata || {}),
    },
  };
}
