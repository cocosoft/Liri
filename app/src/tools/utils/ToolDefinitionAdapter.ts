/**
 * ToolDefinitionAdapter — 将 CC 风格的 ToolDefinition + ToolImplementation
 * 包装为原始 Tool 接口实例，统一注册到 ToolRegistry。
 */
import type {
  Tool,
  ToolInfo,
  ToolParam,
  ToolCallProgress,
} from '../types/Tool';
import { ToolTag } from '../types/Tool';
import type { ToolUseContext } from '../types/ToolUseContext';
import { ToolExecutionStatus, type ToolResult } from '../types/ToolResult';
import type { PermissionResult } from '../types/PermissionResult';
import type { ValidationResult } from '../types/Tool';
import type {
  ToolDefinition,
  ToolParameter,
  ToolImplementation,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../types/ToolTypes';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:utils:ToolDefinitionAdapter');

function mapToolParam(p: ToolParameter): ToolParam {
  return {
    name: p.name,
    type: p.type,
    description: p.description,
    required: p.required ?? false,
    default: p.default,
  };
}

function buildToolExecutionContext(
  input: unknown,
  _context: ToolUseContext,
  definition: ToolDefinition
): ToolExecutionContext {
  const params =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  return {
    executionId: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    userId: '',
    sessionId: 'default',
    workingDirectory: process.cwd(),
    environment: {},
    parameters: params,
    config: definition.config ?? {},
    options: {
      timeout: definition.timeout ?? 30000,
    },
  };
}

function mapExecutionResult(
  result: ToolExecutionResult,
  executionTime: number
): ToolResult {
  return {
    success: result.success,
    output: result.output !== undefined ? String(result.output) : undefined,
    error: result.error,
    executionTime,
    status: result.success
      ? ToolExecutionStatus.SUCCESS
      : ToolExecutionStatus.FAILURE,
  };
}

function buildToolInfo(definition: ToolDefinition): ToolInfo {
  return {
    name: definition.name,
    description: definition.description,
    params: (definition.parameters ?? []).map(mapToolParam),
    enabled: definition.enabled ?? true,
    readOnly: false,
    destructive: false,
    concurrencySafe: false,
    deferred: false,
    alwaysLoad: false,
    interruptBehavior: 'block',
    maxResultSizeChars: undefined,
    tags: definition.tags?.filter((t): t is ToolTag =>
      Object.values<string>(ToolTag).includes(t)
    ),
  };
}

export class ToolDefinitionAdapter implements Tool {
  readonly name: string;
  readonly description: string;
  readonly params: ToolParam[];

  private definition: ToolDefinition;
  private implementation: ToolImplementation;
  private info: ToolInfo;

  constructor(definition: ToolDefinition, implementation: ToolImplementation) {
    this.definition = definition;
    this.implementation = implementation;
    this.info = buildToolInfo(definition);
    this.name = definition.name;
    this.description = definition.description;
    this.params = this.info.params;
  }

  getInfo(): ToolInfo {
    return this.info;
  }

  isEnabled(): boolean {
    return this.info.enabled;
  }

  isReadOnly(_input?: Record<string, unknown>): boolean {
    return this.info.readOnly;
  }

  isDestructive(_input?: Record<string, unknown>): boolean {
    return this.info.destructive;
  }

  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return this.info.concurrencySafe;
  }

  interruptBehavior(): 'cancel' | 'block' {
    return 'block';
  }

  async execute(
    input: unknown,
    context: ToolUseContext,
    _onProgress?: ToolCallProgress
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const execContext = buildToolExecutionContext(
      input,
      context,
      this.definition
    );

    try {
      const result = await this.implementation(execContext);
      const executionTime = Date.now() - startTime;
      return mapExecutionResult(result, executionTime);
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
        status: ToolExecutionStatus.FAILURE,
      };
    }
  }

  async checkPermissions(
    _input: unknown,
    _context: ToolUseContext
  ): Promise<PermissionResult> {
    return { behavior: 'allow' };
  }

  validateInput(_input: unknown): ValidationResult {
    return { result: true };
  }
}
