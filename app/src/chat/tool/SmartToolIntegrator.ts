import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

//
export interface SmartTool {
  name: string;
  description: string;
  version: string;
  parameters: Record<string, unknown>;
  execute: (
    args: Record<string, unknown>,
    context: ToolContext
  ) => Promise<unknown>;
  validate?: (args: Record<string, unknown>) => string | null;
  timeout?: number;
  requiredContext?: string[];
}

export interface ToolContext {
  sessionId?: string;
  userId?: string;
  messageHistory?: Array<{ role: string; content: string }>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ToolExecutionResult {
  toolName: string;
  success: boolean;
  result: unknown;
  error?: string;
  executionTime: number;
  retryCount: number;
  timestamp: number;
}

export interface ToolUsageMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  avgExecutionTime: number;
  totalExecutionTime: number;
  byTool: Record<
    string,
    {
      total: number;
      success: number;
      fail: number;
      avgTime: number;
    }
  >;
  cacheHits: number;
  cacheMisses: number;
}

export interface ToolCompatibilityReport {
  compatible: boolean;
  toolName: string;
  missingContext: string[];
  suggestions: string[];
}

export interface ISmartToolIntegrator {
  registerTool(tool: SmartTool): void;
  unregisterTool(name: string): boolean;
  getTool(name: string): SmartTool | null;
  executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolExecutionResult>;
  executeMultiple(
    tools: Array<{ name: string; args: Record<string, unknown> }>,
    context: ToolContext
  ): Promise<ToolExecutionResult[]>;
  validateCompatibility(
    toolName: string,
    context: ToolContext
  ): ToolCompatibilityReport;
  getRecommendedTools(context: ToolContext, limit?: number): string[];
  getToolUsageMetrics(): ToolUsageMetrics;
  clearCache(): number;
}

export class SmartToolIntegrator implements ISmartToolIntegrator {
  private tools: Map<string, SmartTool> = new Map();
  private executionHistory: ToolExecutionResult[] = [];
  private resultCache: Map<string, { result: unknown; expiresAt: number }> =
    new Map();
  private maxHistorySize: number;
  private cacheTTL: number;
  private maxRetries: number;

  constructor(
    maxHistorySize: number = 1000,
    cacheTTL: number = 30000,
    maxRetries: number = 2
  ) {
    this.maxHistorySize = maxHistorySize;
    this.cacheTTL = cacheTTL;
    this.maxRetries = maxRetries;
  }

  registerTool(tool: SmartTool): void {
    if (this.tools.has(tool.name)) {
      throw new AppError(
        `Tool already registered: ${tool.name}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    this.tools.set(tool.name, tool);
  }

  unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }

  getTool(name: string): SmartTool | null {
    return this.tools.get(name) || null;
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        toolName: name,
        success: false,
        result: null,
        error: `Tool not found: ${name}`,
        executionTime: 0,
        retryCount: 0,
        timestamp: Date.now(),
      };
    }

    const cacheKey = this.buildCacheKey(name, args, context);
    const cached = this.resultCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        toolName: name,
        success: true,
        result: cached.result,
        executionTime: 0,
        retryCount: 0,
        timestamp: Date.now(),
      };
    }

    let lastError: string | null = null;
    const startTime = Date.now();
    let retryCount = 0;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) retryCount++;

      try {
        if (tool.validate) {
          const validationError = tool.validate(args);
          if (validationError) {
            return {
              toolName: name,
              success: false,
              result: null,
              error: `Validation error: ${validationError}`,
              executionTime: Date.now() - startTime,
              retryCount: 0,
              timestamp: Date.now(),
            };
          }
        }

        const result = await tool.execute(args, context);

        if (this.cacheTTL > 0) {
          this.resultCache.set(cacheKey, {
            result,
            expiresAt: Date.now() + this.cacheTTL,
          });
          this.cleanupCache();
        }

        const executionResult: ToolExecutionResult = {
          toolName: name,
          success: true,
          result,
          executionTime: Date.now() - startTime,
          retryCount,
          timestamp: Date.now(),
        };

        this.recordExecution(executionResult);
        return executionResult;
      } catch (error) {
        lastError = (error as Error).message;
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 100));
        }
      }
    }

    const executionResult: ToolExecutionResult = {
      toolName: name,
      success: false,
      result: null,
      error: lastError || 'Unknown error',
      executionTime: Date.now() - startTime,
      retryCount,
      timestamp: Date.now(),
    };

    this.recordExecution(executionResult);
    return executionResult;
  }

  async executeMultiple(
    tools: Array<{ name: string; args: Record<string, unknown> }>,
    context: ToolContext
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];
    for (const { name, args } of tools) {
      const result = await this.executeTool(name, args, context);
      results.push(result);
    }
    return results;
  }

  validateCompatibility(
    toolName: string,
    context: ToolContext
  ): ToolCompatibilityReport {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        compatible: false,
        toolName,
        missingContext: [],
        issues: [`Tool not found: ${toolName}`],
        suggestions: [],
      } as ToolCompatibilityReport;
    }

    const missingContext: string[] = [];
    if (tool.requiredContext) {
      for (const ctx of tool.requiredContext) {
        if (!(ctx in context)) {
          missingContext.push(ctx);
        }
      }
    }

    const suggestions: string[] = [];
    if (missingContext.length > 0) {
      suggestions.push(`Provide missing context: ${missingContext.join(', ')}`);
    }

    return {
      compatible: missingContext.length === 0,
      toolName,
      missingContext,
      suggestions,
    };
  }

  getRecommendedTools(context: ToolContext, limit: number = 5): string[] {
    const scored: Array<{ name: string; score: number }> = [];

    for (const [, tool] of this.tools) {
      let score = 0;
      if (tool.requiredContext) {
        const matched = tool.requiredContext.filter(
          (ctx) => ctx in context
        ).length;
        score += (matched / tool.requiredContext.length) * 50;
      }
      const report = this.validateCompatibility(tool.name, context);
      if (report.compatible) score += 30;
      const metrics = this.getToolUsageMetrics().byTool[tool.name];
      if (metrics && metrics.success > 0) {
        score += (metrics.success / (metrics.total || 1)) * 20;
      }
      scored.push({ name: tool.name, score });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.name);
  }

  getToolUsageMetrics(): ToolUsageMetrics {
    const metrics: ToolUsageMetrics = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      avgExecutionTime: 0,
      totalExecutionTime: 0,
      byTool: {},
      cacheHits: 0,
      cacheMisses: 0,
    };

    for (const exec of this.executionHistory) {
      metrics.totalExecutions++;
      metrics.totalExecutionTime += exec.executionTime;
      if (exec.success) metrics.successfulExecutions++;
      else metrics.failedExecutions++;

      if (!metrics.byTool[exec.toolName]) {
        metrics.byTool[exec.toolName] = {
          total: 0,
          success: 0,
          fail: 0,
          avgTime: 0,
        };
      }
      metrics.byTool[exec.toolName].total++;
      metrics.byTool[exec.toolName].avgTime += exec.executionTime;
      if (exec.success) metrics.byTool[exec.toolName].success++;
      else metrics.byTool[exec.toolName].fail++;
    }

    if (metrics.totalExecutions > 0) {
      metrics.avgExecutionTime =
        metrics.totalExecutionTime / metrics.totalExecutions;
    }

    for (const [, toolMetrics] of Object.entries(metrics.byTool)) {
      if (toolMetrics.total > 0) {
        toolMetrics.avgTime = toolMetrics.avgTime / toolMetrics.total;
      }
    }

    return metrics;
  }

  clearCache(): number {
    const count = this.resultCache.size;
    this.resultCache.clear();
    return count;
  }

  private buildCacheKey(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): string {
    return `${name}_${JSON.stringify(args)}_${context.sessionId || ''}`;
  }

  private recordExecution(result: ToolExecutionResult): void {
    this.executionHistory.push(result);
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory = this.executionHistory.slice(-this.maxHistorySize);
    }
  }

  private cleanupCache(): void {
    if (this.resultCache.size > 1000) {
      const now = Date.now();
      for (const [key, entry] of this.resultCache) {
        if (entry.expiresAt <= now) this.resultCache.delete(key);
      }
    }
  }
}

export const smartToolIntegrator = new SmartToolIntegrator();
