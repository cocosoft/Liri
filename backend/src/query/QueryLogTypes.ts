/**
 * 查询日志类型定义
 * 记录每次 API 调用、工具调用和完整查询的执行信息
 */

/**
 * 日志条目类型
 */
export type QueryLogEntryType = 'api_call' | 'tool_call' | 'query';

/**
 * 查询日志条目
 */
export interface QueryLogEntry {
  /** 唯一标识 */
  id: string;

  /** 会话 ID */
  sessionId: string;

  /** 条目类型 */
  type: QueryLogEntryType;

  /** 模型名称（仅 api_call 类型） */
  model?: string;

  /** 提示词 Token 数 */
  promptTokens: number;

  /** 输出 Token 数 */
  outputTokens: number;

  /** 总 Token 数 */
  totalTokens: number;

  /** 耗时（毫秒） */
  durationMs: number;

  /** 是否成功 */
  success: boolean;

  /** 错误信息 */
  error?: string;

  /** 工具名称（仅 tool_call 类型） */
  toolName?: string;

  /** 重试次数（仅 api_call 类型） */
  retryCount?: number;

  /** 查询轮次（仅 query 类型） */
  turnCount?: number;

  /** 工具调用次数（仅 query 类型） */
  toolCallCount?: number;

  /** 时间戳 */
  timestamp: number;

  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 查询日志查询过滤条件
 */
export interface QueryLogFilter {
  /** 会话 ID */
  sessionId?: string;

  /** 条目类型 */
  type?: QueryLogEntryType;

  /** 起始时间 */
  startTime?: number;

  /** 结束时间 */
  endTime?: number;

  /** 是否只返回成功记录 */
  successOnly?: boolean;

  /** 模型名称 */
  model?: string;

  /** 限制条数 */
  limit?: number;

  /** 偏移量 */
  offset?: number;
}

/**
 * 查询日志聚合统计
 */
export interface QueryLogStats {
  /** 总 API 调用次数 */
  totalApiCalls: number;

  /** 总 API 调用耗时 */
  totalApiDurationMs: number;

  /** 总 Token 消耗 */
  totalTokens: number;

  /** 平均 API 调用耗时 */
  avgApiDurationMs: number;

  /** API 调用失败次数 */
  apiErrorCount: number;

  /** API 调用成功率 */
  apiSuccessRate: number;

  /** 总工具调用次数 */
  totalToolCalls: number;

  /** 工具调用失败次数 */
  toolErrorCount: number;

  /** 工具调用成功率 */
  toolSuccessRate: number;

  /** 总查询次数 */
  totalQueries: number;

  /** 统计时间范围起始 */
  startTime: number;

  /** 统计时间范围结束 */
  endTime: number;
}
