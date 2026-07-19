import { ParallelExecutor } from './ParallelExecutor';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools\executor\ExtendedToolExecutor',
  level: LogLevel.INFO,
});

interface ToolDescriptor {
  execute(
    params: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
}

interface ToolRegistry {
  get(toolId: string): ToolDescriptor | undefined;
}

interface ExecuteOptions {
  timeout?: number;
  retry?: {
    enabled: boolean;
    maxAttempts: number;
    delay?: number;
  };
  outputFormat?: 'text' | 'json' | 'html';
  environment?: Record<string, unknown>;
  cwd?: string;
  cache?: boolean;
}

/**
 * 扩展工具执行器
 */
export class ExtendedToolExecutor {
  private toolRegistry: ToolRegistry;
  private parallelExecutor: ParallelExecutor;

  constructor(toolRegistry: ToolRegistry, parallelExecutor?: ParallelExecutor) {
    this.toolRegistry = toolRegistry;
    this.parallelExecutor = parallelExecutor || new ParallelExecutor();
  }

  async executeTool(
    toolId: string,
    params: Record<string, unknown>,
    options: ExecuteOptions = {},
    context: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const startTime = Date.now();

    try {
      const result = await this.doExecute(toolId, params, options, context);
      result.executionTime = Date.now() - startTime;
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
      };
    }
  }

  private async doExecute(
    toolId: string,
    params: Record<string, unknown>,
    options: ExecuteOptions,
    context: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const tool = this.toolRegistry.get(toolId);
    if (!tool) {
      throw new AppError(
        `Tool not found: ${toolId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1005'
      );
    }

    if (options.timeout) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeout);

      try {
        const result = await Promise.race([
          this.executeWithOptions(tool, params, options, context),
          new Promise<Record<string, unknown>>((_, reject) => {
            controller.signal.addEventListener('abort', () => {
              reject(
                new Error(`Tool execution timed out after ${options.timeout}ms`)
              );
            });
          }),
        ]);
        clearTimeout(timeoutId);
        return result;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    } else {
      return await this.executeWithOptions(tool, params, options, context);
    }
  }

  private async executeWithOptions(
    tool: ToolDescriptor,
    params: Record<string, unknown>,
    options: ExecuteOptions,
    context: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (options.retry?.enabled) {
      let attempts = 0;
      const maxAttempts = options.retry.maxAttempts;
      const delay = options.retry.delay || 1000;

      while (attempts < maxAttempts) {
        try {
          return await this.executeToolInternal(tool, params, options, context);
        } catch (error) {
          attempts++;
          if (attempts >= maxAttempts) {
            throw error;
          }
          await this.sleep(delay);
        }
      }
    }

    return await this.executeToolInternal(tool, params, options, context);
  }

  private async executeToolInternal(
    tool: ToolDescriptor,
    params: Record<string, unknown>,
    options: ExecuteOptions,
    context: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const result = await tool.execute(params, {
      ...context,
      env: {
        ...((context.env as Record<string, unknown>) || {}),
        ...options.environment,
      },
      cwd: options.cwd || (context.cwd as string),
    });

    if (options.outputFormat && result.output) {
      result.output = this.formatOutput(
        result.output as string,
        options.outputFormat
      );
    }

    return result;
  }

  private formatOutput(
    output: string,
    format: 'text' | 'json' | 'html'
  ): string {
    switch (format) {
      case 'json':
        try {
          return JSON.stringify(JSON.parse(output), null, 2);
        } catch {
          return JSON.stringify({ output }, null, 2);
        }
      case 'html':
        return `<pre>${this.escapeHtml(output)}</pre>`;
      case 'text':
      default:
        return output;
    }
  }

  private generateCacheKey(
    toolId: string,
    params: Record<string, unknown>
  ): string {
    return `${toolId}:${JSON.stringify(params)}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async executeParallel(
    tasks: Array<{
      toolId: string;
      params: Record<string, unknown>;
      options?: ExecuteOptions;
    }>,
    context: Record<string, unknown>
  ): Promise<unknown[]> {
    const parallelTasks = tasks.map((task) => ({
      execute: () =>
        this.executeTool(task.toolId, task.params, task.options || {}, context),
    }));

    const results =
      await this.parallelExecutor.execute<Record<string, unknown>>(
        parallelTasks
      );
    return results.map((r) => r.data);
  }

  async clearCache(): Promise<void> {
    // 缓存清理功能暂时不可用
  }

  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }
}
