/**
 * 扩展工具执行器
 */

import { ParallelExecutor } from './ParallelExecutor';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * 扩展工具执行器
 */
export class ExtendedToolExecutor {
  private toolRegistry: any;
  private parallelExecutor: ParallelExecutor;

  /**
   * 构造函数
   */
  constructor(toolRegistry: any, parallelExecutor?: ParallelExecutor) {
    this.toolRegistry = toolRegistry;
    this.parallelExecutor = parallelExecutor || new ParallelExecutor();
  }

  /**
   * 执行工具
   */
  async executeTool(
    toolId: string,
    params: any,
    options: any = {},
    context: any
  ): Promise<any> {
    const startTime = Date.now();

    try {
      // 执行工具
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

  /**
   * 执行工具（内部方法）
   */
  private async doExecute(
    toolId: string,
    params: any,
    options: any,
    context: any
  ): Promise<any> {
    // 检查工具是否存在
    const tool = this.toolRegistry.get(toolId);
    if (!tool) {
      throw new AppError(`Tool not found: ${toolId}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1005');
    }

    // 应用超时
    if (options.timeout) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeout);

      try {
        const result = await Promise.race([
          this.executeWithOptions(tool, params, options, context),
          new Promise<any>((_, reject) => {
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

  /**
   * 执行工具（带选项）
   */
  private async executeWithOptions(
    tool: any,
    params: any,
    options: any,
    context: any
  ): Promise<any> {
    // 应用重试策略
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

  /**
   * 执行工具（内部）
   */
  private async executeToolInternal(
    tool: any,
    params: any,
    options: any,
    context: any
  ): Promise<any> {
    // 执行工具
    const result = await tool.execute(params, {
      ...context,
      env: {
        ...context.env,
        ...options.environment,
      },
      cwd: options.cwd || context.cwd,
    });

    // 格式化输出
    if (options.outputFormat && result.output) {
      result.output = this.formatOutput(result.output, options.outputFormat);
    }

    return result;
  }

  /**
   * 格式化输出
   */
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

  /**
   * 生成缓存键
   */
  private generateCacheKey(toolId: string, params: any): string {
    return `${toolId}:${JSON.stringify(params)}`;
  }

  /**
   * 睡眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 转义HTML
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * 并行执行多个工具
   */
  async executeParallel(
    tasks: Array<{
      toolId: string;
      params: any;
      options?: any;
    }>,
    context: any
  ): Promise<any[]> {
    const parallelTasks = tasks.map((task) => ({
      execute: () =>
        this.executeTool(
          task.toolId,
          task.params,
          task.options || {},
          context
        ),
    }));

    const results = await this.parallelExecutor.execute<any>(parallelTasks);
    return results.map((r) => r.data);
  }

  /**
   * 清理缓存
   */
  async clearCache(): Promise<void> {
    // 缓存清理功能暂时不可用
  }

  /**
   * 设置工具注册表
   */
  setToolRegistry(registry: any): void {
    this.toolRegistry = registry;
  }
}
