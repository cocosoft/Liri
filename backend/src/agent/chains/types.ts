/**
 * Agent Chain 链式调用类型定义
 */

/**
 * 链步骤执行策略
 */
export type ChainErrorStrategy = 'abort' | 'skip' | 'retry';

/**
 * 链步骤执行模式
 */
export type ChainExecutionMode = 'sequential' | 'parallel';

/**
 * 链步骤状态
 */
export type ChainStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'aborted';

/**
 * 链整体状态
 */
export type ChainStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted';

/**
 * 链步骤定义
 */
export interface ChainStep {
  /** 步骤 ID */
  id: string;
  /** 步骤名称 */
  name: string;
  /** 步骤描述 */
  description?: string;
  /** Agent 类型 */
  agentType: string;
  /** Agent 系统提示词模板（支持 {{previousOutput}} 占位符） */
  systemPrompt?: string;
  /** 输入转换函数，将前一步输出转为当前步输入 */
  inputTransform?: (previousOutput: string, chainInput: string) => string;
  /** 执行模式 */
  mode?: ChainExecutionMode;
  /** 子步骤列表（并行执行时使用） */
  substeps?: ChainStep[];
  /** 错误处理策略 */
  onError?: ChainErrorStrategy;
  /** 重试次数（onError=retry 时生效） */
  retryCount?: number;
  /** 步骤超时（毫秒） */
  timeoutMs?: number;
  /** 条件分支：仅当条件满足时执行 */
  condition?: (previousOutput: string) => boolean;
}

/**
 * 链定义
 */
export interface ChainDefinition {
  /** 链 ID */
  id: string;
  /** 链名称 */
  name: string;
  /** 链描述 */
  description: string;
  /** 链步骤列表 */
  steps: ChainStep[];
  /** 默认错误处理策略 */
  defaultOnError?: ChainErrorStrategy;
  /** 默认超时（毫秒） */
  defaultTimeoutMs?: number;
  /** 标签 */
  tags?: string[];
  /** 版本 */
  version?: string;
  /** 作者 */
  author?: string;
}

/**
 * 链执行请求
 */
export interface ChainExecutionRequest {
  /** 链 ID */
  chainId: string;
  /** 输入内容 */
  input: string;
  /** 是否在第一步失败时中止 */
  abortOnFirstError?: boolean;
  /** 变量（用于模板替换） */
  variables?: Record<string, string>;
}

/**
 * 链步骤结果
 */
export interface ChainStepResult {
  /** 步骤 ID */
  stepId: string;
  /** 步骤名称 */
  stepName: string;
  /** 执行状态 */
  status: ChainStepStatus;
  /** 输出内容 */
  output: string;
  /** 错误信息 */
  error?: string;
  /** 执行时长（毫秒） */
  durationMs: number;
  /** 子步骤结果 */
  substepResults?: ChainStepResult[];
  /** Token 使用情况 */
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * 链执行进度事件
 */
export interface ChainProgressEvent {
  /** 链 ID */
  chainId: string;
  /** 事件类型 */
  type:
    | 'step_start'
    | 'step_complete'
    | 'step_fail'
    | 'chain_complete'
    | 'chain_fail'
    | 'chain_abort';
  /** 当前步骤 */
  currentStep: number;
  /** 总步骤数 */
  totalSteps: number;
  /** 消息 */
  message: string;
  /** 步骤结果 */
  stepResult?: ChainStepResult;
}

/**
 * 链执行结果
 */
export interface ChainExecutionResult {
  /** 链 ID */
  chainId: string;
  /** 链名称 */
  chainName: string;
  /** 执行状态 */
  status: ChainStatus;
  /** 最终输出 */
  output: string;
  /** 步骤结果列表 */
  stepResults: ChainStepResult[];
  /** 执行时长（毫秒） */
  totalDurationMs: number;
  /** 总 Token 使用情况 */
  totalTokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** 错误信息 */
  error?: string;
}

/**
 * 链注册信息
 */
export interface ChainRegistration {
  /** 链定义 */
  definition: ChainDefinition;
  /** 注册时间 */
  registeredAt: number;
  /** 使用次数 */
  useCount: number;
}
