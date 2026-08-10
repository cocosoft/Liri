/**
 * AgentChain - Agent 链式调用引擎
 *
 * 支持将多个 Agent 按顺序或并行组成执行流水线：
 * - 顺序执行：Agent A 的输出作为 Agent B 的输入
 * - 并行执行：同一阶段多个子步骤并行执行
 * - 条件分支：根据前一步输出决定是否执行当前步
 * - 错误策略：abort / skip / retry
 * - 进度事件通知
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import {
  ChainDefinition,
  ChainStep,
  ChainExecutionRequest,
  ChainExecutionResult,
  ChainStepResult,
  ChainProgressEvent,
  ChainRegistration,
  ChainStatus,
  ChainStepStatus,
  ChainExecutionMode,
} from './types';

import { globalEventBus } from '../../core/events/EventBus.js';
import { OrchestrationEventType } from '../events/OrchestrationEvents.js';
import { getAgentRegistry } from '../registry/AgentRegistry.js';
import type {
  ChainStartData,
  ChainStepData,
  ChainEndData,
} from '../events/OrchestrationEvents.js';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = getLogger('agent:chains:AgentChain');

/**
 * 模拟 Agent 执行函数
 * 在真实环境中应替换为实际的 Agent 调用
 */
type AgentExecutor = (
  agentType: string,
  input: string,
  systemPrompt?: string
) => Promise<{
  output: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}>;

/**
 * Agent Chain 引擎
 */
export class AgentChain extends EventEmitter {
  private chains: Map<string, ChainRegistration> = new Map();
  private activeExecutions: Map<string, AbortController> = new Map();
  private executor: AgentExecutor;

  /**
   * @param executor Agent 执行函数
   */
  constructor(executor?: AgentExecutor) {
    super();
    this.executor = executor || this.defaultExecutor;
  }

  /**
   * 默认模拟执行器
   */
  private async defaultExecutor(
    agentType: string,
    input: string,
    systemPrompt?: string
  ): Promise<{ output: string }> {
    const lines: string[] = [];
    lines.push(`[Agent: ${agentType}]`);
    if (systemPrompt) {
      lines.push(`[System: ${systemPrompt.substring(0, 50)}...]`);
    }
    lines.push(`[Input: ${input.substring(0, 100)}]`);
    lines.push(
      `[Result: Processed by ${agentType} at ${new Date().toISOString()}]`
    );
    return { output: lines.join('\n') };
  }

  /**
   * 注册链
   */
  register(definition: ChainDefinition): void {
    const id = definition.id || randomUUID();
    this.chains.set(id, {
      definition: { ...definition, id },
      registeredAt: Date.now(),
      useCount: 0,
    });
  }

  /**
   * 注销链
   */
  unregister(chainId: string): boolean {
    return this.chains.delete(chainId);
  }

  /**
   * 获取已注册的链
   */
  getChain(chainId: string): ChainDefinition | undefined {
    return this.chains.get(chainId)?.definition;
  }

  /**
   * 列出所有已注册的链
   */
  listChains(): ChainDefinition[] {
    return Array.from(this.chains.values()).map((r) => r.definition);
  }

  /**
   * 按标签筛选链
   */
  findChainsByTag(tag: string): ChainDefinition[] {
    return this.listChains().filter((c) => c.tags?.includes(tag));
  }

  /**
   * 执行链
   */
  async execute(request: ChainExecutionRequest): Promise<ChainExecutionResult> {
    const registration = this.chains.get(request.chainId);
    if (!registration) {
      return {
        chainId: request.chainId,
        chainName: request.chainId,
        status: 'failed',
        output: '',
        stepResults: [],
        totalDurationMs: 0,
        totalTokenUsage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        error: `Chain ${request.chainId} not found`,
      };
    }

    const chain = registration.definition;
    const abortController = new AbortController();
    const executionId = randomUUID();

    this.activeExecutions.set(executionId, abortController);

    try {
      const result = await this.executeChain(
        chain,
        request,
        abortController.signal
      );
      registration.useCount++;
      return result;
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * 内部：执行完整链
   */
  private async executeChain(
    chain: ChainDefinition,
    request: ChainExecutionRequest,
    signal: AbortSignal
  ): Promise<ChainExecutionResult> {
    const startTime = Date.now();
    const stepResults: ChainStepResult[] = [];
    let currentInput = request.input;
    let chainStatus: ChainStatus = 'running';
    let chainError: string | undefined;

    const totalSteps = chain.steps.length;
    const defaultTimeout = chain.defaultTimeoutMs ?? 60000;

    // 发射链开始事件
    try {
      const startData: ChainStartData = {
        chainId: chain.id,
        chainName: chain.name,
        totalSteps,
        input: request.input,
      };
      globalEventBus.publish(OrchestrationEventType.CHAIN_START, startData);
    } catch (err) {
      handleError(err, {
        module: 'agent:chains',
        action: 'emitChainStart',
      });
    }

    for (let i = 0; i < totalSteps; i++) {
      if (signal.aborted) {
        chainStatus = 'aborted';
        chainError = 'Chain execution was aborted';
        break;
      }

      const step = chain.steps[i];
      const stepResult = await this.executeStep(
        step,
        currentInput,
        request,
        signal,
        defaultTimeout
      );

      stepResults.push(stepResult);

      this.emitProgress({
        chainId: chain.id,
        type: stepResult.status === 'completed' ? 'step_complete' : 'step_fail',
        currentStep: i + 1,
        totalSteps,
        message: `Step ${i + 1}/${totalSteps}: ${step.name} - ${stepResult.status}`,
        stepResult,
      });

      if (stepResult.status === 'completed') {
        currentInput = stepResult.output;
      } else if (
        stepResult.status === 'failed' ||
        stepResult.status === 'aborted'
      ) {
        const errorStrategy = step.onError || chain.defaultOnError || 'abort';
        if (errorStrategy === 'abort') {
          chainStatus = stepResult.status === 'aborted' ? 'aborted' : 'failed';
          chainError = stepResult.error || `Step ${step.name} failed`;
          break;
        }
      }
    }

    if (chainStatus === 'running') {
      chainStatus = 'completed';
    }

    const totalDurationMs = Date.now() - startTime;
    const totalTokenUsage = this.aggregateTokenUsage(stepResults);

    this.emitProgress({
      chainId: chain.id,
      type:
        chainStatus === 'completed'
          ? 'chain_complete'
          : chainStatus === 'aborted'
            ? 'chain_abort'
            : 'chain_fail',
      currentStep: stepResults.length,
      totalSteps,
      message: `Chain ${chain.name}: ${chainStatus}`,
    });

    // 发射链完成事件
    try {
      const endData: ChainEndData = {
        chainId: chain.id,
        chainName: chain.name,
        status: chainStatus,
        totalDurationMs,
        totalTokenUsage,
        error: chainError,
      };
      globalEventBus.publish(OrchestrationEventType.CHAIN_END, endData);
    } catch (err) {
      handleError(err, {
        module: 'agent:chains',
        action: 'emitChainEnd',
      });
    }

    return {
      chainId: chain.id,
      chainName: chain.name,
      status: chainStatus,
      output: currentInput,
      stepResults,
      totalDurationMs,
      totalTokenUsage,
      error: chainError,
    };
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(
    step: ChainStep,
    input: string,
    request: ChainExecutionRequest,
    signal: AbortSignal,
    defaultTimeout: number
  ): Promise<ChainStepResult> {
    if (signal.aborted) {
      return {
        stepId: step.id,
        stepName: step.name,
        status: 'aborted',
        output: '',
        durationMs: 0,
      };
    }

    if (step.condition && !step.condition(input)) {
      return {
        stepId: step.id,
        stepName: step.name,
        status: 'skipped',
        output: '',
        durationMs: 0,
      };
    }

    const startTime = Date.now();
    const timeout = step.timeoutMs || defaultTimeout;
    const maxRetries = step.onError === 'retry' ? step.retryCount || 2 : 0;

    // 从 AgentRegistry 查找 Agent 定义，获取系统提示词
    const registry = getAgentRegistry();
    const agentDef = registry.getAgent(step.agentType);

    // 优先使用 step.systemPrompt，其次使用 AgentRegistry 中注册的 systemPrompt
    const systemPrompt = step.systemPrompt
      ? this.resolveTemplate(step.systemPrompt, input, request)
      : agentDef?.systemPrompt
        ? this.resolveTemplate(agentDef.systemPrompt, input, request)
        : undefined;

    let stepInput = input;
    if (step.inputTransform) {
      stepInput = step.inputTransform(input, request.input);
    }

    let lastError: string | undefined;
    let attempt = 0;

    this.emitProgress({
      chainId: request.chainId,
      type: 'step_start',
      currentStep: 0,
      totalSteps: 0,
      message: `Starting step: ${step.name}`,
    });

    while (attempt <= maxRetries) {
      if (signal.aborted) {
        return {
          stepId: step.id,
          stepName: step.name,
          status: 'aborted',
          output: '',
          durationMs: Date.now() - startTime,
        };
      }

      try {
        if (
          step.mode === 'parallel' &&
          step.substeps &&
          step.substeps.length > 0
        ) {
          return await this.executeParallelStep(
            step,
            stepInput,
            request,
            signal,
            defaultTimeout,
            startTime
          );
        }

        const result = await this.executeWithTimeout(
          () => this.executor(step.agentType, stepInput, systemPrompt),
          timeout,
          signal
        );

        return {
          stepId: step.id,
          stepName: step.name,
          status: 'completed',
          output: result.output,
          durationMs: Date.now() - startTime,
          tokenUsage: result.tokenUsage,
        };
      } catch (err) {
        lastError = String(err);
        attempt++;
      }
    }

    if (signal.aborted) {
      return {
        stepId: step.id,
        stepName: step.name,
        status: 'aborted',
        output: '',
        error: 'Execution was aborted',
        durationMs: Date.now() - startTime,
      };
    }

    return {
      stepId: step.id,
      stepName: step.name,
      status: 'failed',
      output: '',
      error: lastError,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * 并行执行子步骤
   */
  private async executeParallelStep(
    step: ChainStep,
    input: string,
    request: ChainExecutionRequest,
    signal: AbortSignal,
    defaultTimeout: number,
    startTime: number
  ): Promise<ChainStepResult> {
    const substepResults = await Promise.all(
      (step.substeps || []).map((substep) =>
        this.executeStep(substep, input, request, signal, defaultTimeout)
      )
    );

    const allCompleted = substepResults.every((r) => r.status === 'completed');
    const outputs = substepResults.map((r) => r.output).filter(Boolean);

    return {
      stepId: step.id,
      stepName: step.name,
      status: allCompleted ? 'completed' : 'failed',
      output: outputs.join('\n---\n'),
      durationMs: Date.now() - startTime,
      substepResults,
    };
  }

  /**
   * 带超时的异步执行
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Execution was aborted'));
        return;
      }

      const timer = setTimeout(() => {
        reject(new Error(`Execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const abortHandler = () => {
        clearTimeout(timer);
        reject(new Error('Execution was aborted'));
      };

      signal?.addEventListener('abort', abortHandler, { once: true });

      fn().then(
        (result) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abortHandler);
          resolve(result);
        },
        (err) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abortHandler);
          reject(err);
        }
      );
    });
  }

  /**
   * 解析模板中的占位符
   */
  private resolveTemplate(
    template: string,
    previousOutput: string,
    request: ChainExecutionRequest
  ): string {
    let result = template.replace(/\{\{previousOutput\}\}/g, previousOutput);
    result = result.replace(/\{\{input\}\}/g, request.input);

    if (request.variables) {
      for (const [key, value] of Object.entries(request.variables)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
    }

    return result;
  }

  /**
   * 汇总所有步骤的 Token 使用量
   */
  private aggregateTokenUsage(stepResults: ChainStepResult[]): {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } {
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    for (const step of stepResults) {
      if (step.tokenUsage) {
        promptTokens += step.tokenUsage.promptTokens;
        completionTokens += step.tokenUsage.completionTokens;
        totalTokens += step.tokenUsage.totalTokens;
      }
      if (step.substepResults) {
        const sub = this.aggregateTokenUsage(step.substepResults);
        promptTokens += sub.promptTokens;
        completionTokens += sub.completionTokens;
        totalTokens += sub.totalTokens;
      }
    }

    return { promptTokens, completionTokens, totalTokens };
  }

  /**
   * 发送进度事件（同时桥接到 globalEventBus）
   */
  private emitProgress(event: ChainProgressEvent): void {
    // 保持向后兼容：仍通过 EventEmitter 发射
    this.emit('progress', event);

    // 桥接到全局编排事件总线
    try {
      // 步骤级事件 → CHAIN_STEP
      if (
        event.type === 'step_start' ||
        event.type === 'step_complete' ||
        event.type === 'step_fail'
      ) {
        const stepData: ChainStepData = {
          chainId: event.chainId,
          stepIndex: event.currentStep,
          totalSteps: event.totalSteps,
          stepName: event.stepResult?.stepName ?? '',
          status:
            event.type === 'step_start'
              ? 'running'
              : event.type === 'step_complete'
                ? 'completed'
                : 'failed',
          output: event.stepResult?.output,
          error: event.stepResult?.error,
          durationMs: event.stepResult?.durationMs,
        };
        globalEventBus.publish(OrchestrationEventType.CHAIN_STEP, stepData);
      }
    } catch (err) {
      // EventBus 发射失败不阻塞主流程

      handleError(err, {
        module: 'agent:chains',
        action: 'emitChainStep',
      });
    }
  }

  /**
   * 中止指定链的执行
   */
  abort(executionId: string): boolean {
    const controller = this.activeExecutions.get(executionId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  /**
   * 获取活跃执行数
   */
  getActiveExecutionCount(): number {
    return this.activeExecutions.size;
  }

  /**
   * 重置所有状态
   */
  reset(): void {
    for (const controller of this.activeExecutions.values()) {
      controller.abort();
    }
    this.activeExecutions.clear();
    this.chains.clear();
    this.removeAllListeners();
  }
}

export const agentChain = new AgentChain();
