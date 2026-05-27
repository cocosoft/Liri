/**
 * 工具类型定义
 */

import type { ToolResult, ToolContext } from '../core/types';

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: any;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: ToolSchema;
  alwaysLoad?: boolean;
  isMcp?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  schema: ToolSchema;
  execute(args: any, context: ToolContext): Promise<ToolResult>;
}

export type { ToolResult, ToolContext };

export type {
  ToolParam,
  ToolInfo,
  ToolCallProgress,
  ToolProgressData,
  InterruptBehavior,
  ValidationResult,
  Tools,
  ToolDef,
} from './types/index';

export type { ToolUseContext } from './types/ToolUseContext';
export type { PermissionResult } from './types/PermissionResult';
