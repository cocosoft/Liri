/**
 * FlowEngine 流程引擎
 * P2 — 对标 OpenClaw 的流程系统
 */

/**
 * 流程步骤
 */
export interface FlowStep {
  id: string;
  name: string;
  type: 'action' | 'condition' | 'parallel' | 'subflow' | 'wait';
  handler: (context: FlowContext) => Promise<FlowStepResult> | FlowStepResult;
  next?: string;
  onFailure?: string;
  timeout?: number;
  retryCount?: number;
}

/**
 * 步骤结果
 */
export interface FlowStepResult {
  success: boolean;
  next?: string;
  data?: unknown;
  error?: string;
}

/**
 * 流程定义
 */
export interface FlowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  steps: FlowStep[];
  startStep: string;
  config?: {
    maxRetries?: number;
    timeout?: number;
    enableHistory?: boolean;
  };
}

/**
 * 流程上下文
 */
export interface FlowContext {
  flowId: string;
  executionId: string;
  stepId: string;
  data: Record<string, unknown>;
  history: Array<{ stepId: string; result: FlowStepResult; timestamp: number }>;
  startTime: number;
  metadata?: Record<string, unknown>;
}

/**
 * 流程结果
 */
export interface FlowResult {
  success: boolean;
  flowId: string;
  executionId: string;
  duration: number;
  currentStep: string;
  error?: string;
  data: Record<string, unknown>;
  history: Array<{ stepId: string; result: FlowStepResult; timestamp: number }>;
}

/**
 * 流程配置
 */
export interface FlowConfig {
  maxExecutions: number;
  defaultTimeout: number;
  enableHistory: boolean;
}

/**
 * 流程引擎
 */
export class FlowEngine {
  private flows: Map<string, FlowDefinition> = new Map();
  private executions: Map<string, FlowContext> = new Map();
  private config: FlowConfig;

  constructor(config?: Partial<FlowConfig>) {
    this.config = {
      maxExecutions: config?.maxExecutions || 100,
      defaultTimeout: config?.defaultTimeout || 300000,
      enableHistory: config?.enableHistory !== false,
    };
  }

  /**
   * 注册流程
   */
  register(flow: FlowDefinition): void {
    this.flows.set(flow.id, flow);
  }

  /**
   * 执行流程
   */
  async execute(
    flowId: string,
    initialData?: Record<string, unknown>
  ): Promise<FlowResult> {
    const flow = this.flows.get(flowId);

    if (!flow) {
      return {
        success: false,
        flowId,
        executionId: '',
        duration: 0,
        currentStep: '',
        error: `未找到流程: ${flowId}`,
        data: {},
        history: [],
      };
    }

    if (this.executions.size >= this.config.maxExecutions) {
      return {
        success: false,
        flowId,
        executionId: '',
        duration: 0,
        currentStep: '',
        error: '达到最大并发执行数',
        data: {},
        history: [],
      };
    }

    const executionId = `exec_${flowId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const context: FlowContext = {
      flowId,
      executionId,
      stepId: flow.startStep,
      data: { ...initialData },
      history: [],
      startTime: Date.now(),
    };

    this.executions.set(executionId, context);

    const result = await this.executeStep(flow, flow.startStep, context);

    this.executions.delete(executionId);

    return {
      success: result.success,
      flowId,
      executionId,
      duration: Date.now() - context.startTime,
      currentStep: flow.startStep,
      error: result.error,
      data: context.data,
      history: context.history,
    };
  }

  /**
   * 执行步骤
   */
  private async executeStep(
    flow: FlowDefinition,
    stepId: string,
    context: FlowContext
  ): Promise<FlowStepResult> {
    const step = flow.steps.find((s) => s.id === stepId);

    if (!step) {
      return { success: false, error: `未找到步骤: ${stepId}` };
    }

    context.stepId = stepId;

    try {
      let result: FlowStepResult;

      if (step.timeout) {
        result = await this.executeWithTimeout(step, context, step.timeout);
      } else if (this.config.defaultTimeout > 0) {
        result = await this.executeWithTimeout(
          step,
          context,
          this.config.defaultTimeout
        );
      } else {
        result = await step.handler(context);
      }

      if (this.config.enableHistory) {
        context.history.push({ stepId, result, timestamp: Date.now() });
      }

      if (!result.success && step.onFailure) {
        return this.executeStep(flow, step.onFailure, context);
      }

      if (result.next || step.next) {
        return this.executeStep(flow, result.next || step.next!, context);
      }

      return result;
    } catch (err) {
      const errorResult: FlowStepResult = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };

      if (this.config.enableHistory) {
        context.history.push({
          stepId,
          result: errorResult,
          timestamp: Date.now(),
        });
      }

      if (step.onFailure) {
        return this.executeStep(flow, step.onFailure, context);
      }

      return errorResult;
    }
  }

  /**
   * 带超时的执行
   */
  private async executeWithTimeout(
    step: FlowStep,
    context: FlowContext,
    timeout: number
  ): Promise<FlowStepResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({ success: false, error: `步骤超时: ${step.name}` });
      }, timeout);

      Promise.resolve(step.handler(context))
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * 获取流程定义
   */
  getFlow(id: string): FlowDefinition | undefined {
    return this.flows.get(id);
  }

  /**
   * 列出所有流程
   */
  listFlows(): FlowDefinition[] {
    return Array.from(this.flows.values());
  }

  /**
   * 删除流程
   */
  deleteFlow(id: string): boolean {
    return this.flows.delete(id);
  }
}

export const flowEngine = new FlowEngine();
