/**
 * 工具类型
 */
export enum ToolType {
  /**
   * Bash工具
   */
  BASH = 'bash',

  /**
   * 文件工具
   */
  FILE = 'file',

  /**
   * 网络工具
   */
  NETWORK = 'network',

  /**
   * 系统工具
   */
  SYSTEM = 'system',

  /**
   * 自定义工具
   */
  CUSTOM = 'custom',
}

/**
 * 工具调用接口
 */
export interface ToolCall {
  /**
   * 工具调用ID
   */
  id: string;

  /**
   * 工具名称
   */
  name: string;

  /**
   * 工具参数
   */
  arguments: Record<string, unknown>;

  /**
   * 工具类型
   */
  type?: ToolType;

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 创建时间
   */
  createdAt?: Date;
}

/**
 * 获取工具调用名称的辅助函数
 * 兼容不同的工具调用结构
 */
export function getToolCallName(toolCall: {
  name?: string;
  function?: string;
}): string {
  return toolCall.name || toolCall.function || '';
}

/**
 * 工具使用接口
 */
export interface ToolUse {
  /**
   * 工具调用ID
   */
  id: string;

  /**
   * 工具名称
   */
  function: string;

  /**
   * 工具参数
   */
  arguments: Record<string, unknown>;

  /**
   * 工具类型
   */
  type?: ToolType;

  /**
   * 会话ID
   */
  sessionId?: string;

  /**
   * 创建时间
   */
  createdAt?: Date;
}

/**
 * 工具集成接口
 */
export interface ToolIntegration {
  /**
   * 执行工具
   * @param toolCall 工具调用
   * @returns 工具结果
   */
  executeTool(toolCall: ToolCall): Promise<ToolResult>;
}

/**
 * 工具结果接口
 */
export interface ToolResult {
  /**
   * 工具调用ID
   */
  toolCallId: string;

  /**
   * 工具名称
   */
  toolName: string;

  /**
   * 工具执行结果
   */
  result?: unknown;

  /**
   * 工具执行错误
   */
  error?: string;

  /**
   * 会话ID
   */
  sessionId?: string;
}
