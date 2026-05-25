/**
 * 工具执行结果类型
 * 参考CC_CODE的ToolResult设计，适应backend现有架构
 */
import type { Message } from '@modules/core/types';

export enum ToolExecutionStatus {
  SUCCESS = 'success',
  FAILURE = 'failure',
  PARTIAL = 'partial',
}

/**
 * 错误级别
 * 对标 OpenClaw result.errorLevel：区分错误严重程度，简化后续输出
 */
export enum ErrorLevel {
  /** 纠正型错误：用户可自行纠正，不需要重试 */
  RECOVERABLE = 'recoverable',
  /** 可重试错误：系统可自动重试 */
  RETRYABLE = 'retryable',
  /** 致命错误：需要终止执行 */
  FATAL = 'fatal',
}

export interface ToolResult<T = unknown> {
  data?: T;
  newMessages?: Message[];
  contextModifier?: (context: any) => any;
  mcpMeta?: {
    _meta?: Record<string, unknown>;
    structuredContent?: Record<string, unknown>;
  };
  success?: boolean;
  output?: string;
  error?: string;
  status?: ToolExecutionStatus;
  result?: T;
  executionTime?: number;
  errorOutput?: string;
  progress?: any[];
  metadata?: Record<string, unknown>;
  executionId?: string;
  toolName?: string;
  timestamp?: number;
  content?: string;
  truncated?: boolean;
  /** 错误级别，用于区分错误严重程度 */
  errorLevel?: ErrorLevel;
}

export function createToolResult<T = unknown>(
  data: T,
  options?: Partial<ToolResult<T>>
): ToolResult<T> {
  return {
    data,
    ...options,
  };
}
