/**
 * 支持中断的工具执行器
 * 封装工具执行，提供中断支持
 */

import type { Tool, ToolCall, ToolResult, ToolContext } from '../types/Tool';
import { ToolOrchestration } from './ToolOrchestration';
import { toolResultBudgetManager } from './ToolResultBudget';
import { ModuleError } from '@modules/errors';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools\services\InterruptibleToolExecutor');

export interface InterruptibleExecutorConfig {
  toolRegistry: Map<string, Tool>;
  enableBudgetControl: boolean;
  maxConcurrency: number;
  timeout: number;
  maxRetries: number;
  enableInterruption: boolean;
}

export interface ExecutionState {
  isExecuting: boolean;
  isAborted: boolean;
  currentToolCalls: ToolCall[];
  startTime: number | null;
  abortTime: number | null;
}

export class InterruptibleToolExecutor {
  private config: Required<InterruptibleExecutorConfig>;
  private orchestration: ToolOrchestration;
  private abortController: AbortController | null = null;
  private state: ExecutionState;

  constructor(config: InterruptibleExecutorConfig) {
    this.config = {
      toolRegistry: config.toolRegistry,
      enableBudgetControl: config.enableBudgetControl ?? true,
      maxConcurrency: config.maxConcurrency || 5,
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 3,
      enableInterruption: config.enableInterruption ?? true,
    };
    this.orchestration = new ToolOrchestration({
      maxConcurrency: this.config.maxConcurrency,
      timeout: this.config.timeout,
      maxRetries: this.config.maxRetries,
      enableInterruption: this.config.enableInterruption,
    });
    this.state = {
      isExecuting: false,
      isAborted: false,
      currentToolCalls: [],
      startTime: null,
      abortTime: null,
    };
  }

  /**
   * 执行工具调用
   */
  async executeTools(
    toolCalls: ToolCall[],
    context: ToolContext
  ): Promise<ToolResult[]> {
    if (this.state.isExecuting) {
      throw new ModuleError(
        '执行器正忙，请等待当前执行完成',
        'tools',
        'EXECUTOR_BUSY'
      );
    }

    this.state.isExecuting = true;
    this.state.isAborted = false;
    this.state.currentToolCalls = toolCalls;
    this.state.startTime = Date.now();
    this.state.abortTime = null;

    this.abortController = new AbortController();

    try {
      const results = await this.orchestration.execute(
        toolCalls,
        this.config.toolRegistry,
        context,
        this.abortController.signal
      );

      if (this.config.enableBudgetControl) {
        const toolNames = toolCalls.map((tc) => tc.name);
        return toolResultBudgetManager.applyAll(results, toolNames);
      }

      return results;
    } finally {
      this.state.isExecuting = false;
      this.state.currentToolCalls = [];
    }
  }

  /**
   * 中断执行
   */
  abort(): boolean {
    if (!this.state.isExecuting) {
      return false;
    }

    this.state.isAborted = true;
    this.state.abortTime = Date.now();

    if (this.abortController) {
      this.abortController.abort();
    }

    return true;
  }

  /**
   * 获取执行状态
   */
  getState(): ExecutionState {
    return { ...this.state };
  }

  /**
   * 检查是否可以执行
   */
  canExecute(): boolean {
    return !this.state.isExecuting;
  }

  /**
   * 获取中断信号
   */
  getAbortSignal(): AbortSignal | null {
    return this.abortController?.signal || null;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<InterruptibleExecutorConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
