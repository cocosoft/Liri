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
