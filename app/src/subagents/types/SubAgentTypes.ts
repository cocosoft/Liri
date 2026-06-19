/**
 * 子代理类型系统
 * 定义子代理的类型、配置和通信协议
 */

import { Tool } from '../../tools/types/Tool';
import { ToolUseContext } from '../../tools/types/ToolUseContext';
import { ToolResult } from '../../tools/types/ToolResult';

/**
 * 子代理类型枚举
 */
export enum SubAgentType {
  /** 通用子代理 */
  GENERIC = 'generic',
  /** 代码执行子代理 */
  CODE_EXECUTION = 'code_execution',
  /** 网络搜索子代理 */
  WEB_SEARCH = 'web_search',
  /** 数据分析子代理 */
  DATA_ANALYSIS = 'data_analysis',
  /** 系统管理子代理 */
  SYSTEM_MANAGEMENT = 'system_management',
  /** 安全分析子代理 */
  SECURITY_ANALYSIS = 'security_analysis',
  /** 自然语言处理子代理 */
  NLP = 'nlp',
  /** 多模态处理子代理 */
  MULTIMODAL = 'multimodal',
}

/**
 * 子代理状态枚举
 */
export enum SubAgentStatus {
  /** 初始化中 */
  INITIALIZING = 'initializing',
  /** 就绪 */
  READY = 'ready',
  /** 运行中 */
  RUNNING = 'running',
  /** 暂停 */
  PAUSED = 'paused',
  /** 错误 */
  ERROR = 'error',
  /** 已停止 */
  STOPPED = 'stopped',
}

/**
 * 子代理配置
 */
export interface SubAgentConfig {
  /** 子代理名称 */
  name: string;
  /** 子代理类型 */
  type: SubAgentType;
  /** 子代理描述 */
  description?: string;
  /** 子代理版本 */
  version?: string;
  /** 最大执行时间（毫秒） */
  maxExecutionTime?: number;
  /** 最大并发数 */
  maxConcurrency?: number;
  /** 内存限制（MB） */
  memoryLimit?: number;
  /** 工具配置 */
  toolConfig?: {
    /** 启用的工具列表 */
    enabledTools?: string[];
    /** 禁用的工具列表 */
    disabledTools?: string[];
    /** 工具执行限制 */
    executionLimits?: {
      [toolName: string]: {
        /** 最大执行时间（毫秒） */
        maxExecutionTime?: number;
        /** 最大调用次数 */
        maxCalls?: number;
      };
    };
  };
  /** 安全配置 */
  securityConfig?: {
    /** 是否启用沙箱 */
    sandboxEnabled?: boolean;
    /** 网络访问权限 */
    networkAccess?: boolean;
    /** 文件系统访问权限 */
    filesystemAccess?: boolean;
    /** 环境变量访问权限 */
    environmentAccess?: boolean;
  };
  /** 自定义配置 */
  customConfig?: Record<string, unknown>;
}

/**
 * 子代理信息
 */
export interface SubAgentInfo {
  /** 子代理ID */
  id: string;
  /** 子代理名称 */
  name: string;
  /** 子代理类型 */
  type: SubAgentType;
  /** 子代理描述 */
  description?: string;
  /** 子代理版本 */
  version?: string;
  /** 子代理状态 */
  status: SubAgentStatus;
  /** 启动时间 */
  startTime?: Date;
  /** 最后活动时间 */
  lastActivityTime?: Date;
  /** 执行统计 */
  stats?: {
    /** 总执行次数 */
    totalExecutions: number;
    /** 成功执行次数 */
    successfulExecutions: number;
    /** 失败执行次数 */
    failedExecutions: number;
    /** 平均执行时间（毫秒） */
    averageExecutionTime: number;
  };
  /** 配置信息 */
  config: SubAgentConfig;
}

/**
 * 子代理执行请求
 */
export interface SubAgentExecutionRequest {
  /** 请求ID */
  id: string;
  /** 子代理ID */
  subAgentId: string;
  /** 任务描述 */
  task: string;
  /** 输入数据 */
  input?: Record<string, unknown>;
  /** 工具使用上下文 */
  context?: ToolUseContext;
  /** 执行超时（毫秒） */
  timeout?: number;
  /** 执行选项 */
  options?: {
    /** 是否启用工具执行 */
    enableTools?: boolean;
    /** 是否启用记忆 */
    enableMemory?: boolean;
    /** 是否启用学习 */
    enableLearning?: boolean;
  };
}

/**
 * 子代理执行响应
 */
export interface SubAgentExecutionResponse {
  /** 响应ID */
  id: string;
  /** 请求ID */
  requestId: string;
  /** 子代理ID */
  subAgentId: string;
  /** 执行结果 */
  result: unknown;
  /** 执行状态 */
  status: 'success' | 'failure' | 'timeout' | 'cancelled';
  /** 错误信息 */
  error?: string;
  /** 执行时间（毫秒） */
  executionTime: number;
  /** 工具使用记录 */
  toolUsages?: Array<{
    /** 工具名称 */
    toolName: string;
    /** 工具输入 */
    input: Record<string, unknown>;
    /** 工具输出 */
    output: unknown;
    /** 执行时间（毫秒） */
    executionTime: number;
  }>;
  /** 附加信息 */
  metadata?: Record<string, unknown>;
}

/**
 * 子代理消息
 */
export interface SubAgentMessage {
  /** 消息ID */
  id: string;
  /** 发送者ID */
  senderId: string;
  /** 接收者ID */
  recipientId: string;
  /** 消息类型 */
  type: 'task' | 'result' | 'error' | 'status' | 'ping' | 'pong';
  /** 消息内容 */
  content: unknown;
  /** 发送时间 */
  timestamp: Date;
  /** 关联ID */
  correlationId?: string;
}

/**
 * 子代理内存条目
 */
export interface SubAgentMemory {
  /** 内存ID */
  id: string;
  /** 子代理ID */
  subAgentId: string;
  /** 内存类型 */
  type: 'task' | 'result' | 'tool' | 'observation' | 'knowledge';
  /** 内存内容 */
  content: unknown;
  /** 创建时间 */
  createdAt: Date;
  /** 过期时间 */
  expiresAt?: Date;
  /** 优先级 */
  priority?: number;
  /** 标签 */
  tags?: string[];
}

/**
 * 子代理接口
 */
export interface SubAgent {
  /**
   * 获取子代理信息
   * @returns 子代理信息
   */
  getInfo(): SubAgentInfo;

  /**
   * 启动子代理
   * @returns 启动结果
   */
  start(): Promise<boolean>;

  /**
   * 停止子代理
   * @returns 停止结果
   */
  stop(): Promise<boolean>;

  /**
   * 暂停子代理
   * @returns 暂停结果
   */
  pause(): Promise<boolean>;

  /**
   * 恢复子代理
   * @returns 恢复结果
   */
  resume(): Promise<boolean>;

  /**
   * 执行任务
   * @param request 执行请求
   * @returns 执行响应
   */
  execute(
    request: SubAgentExecutionRequest
  ): Promise<SubAgentExecutionResponse>;

  /**
   * 发送消息
   * @param message 消息
   * @returns 发送结果
   */
  sendMessage(message: SubAgentMessage): Promise<boolean>;

  /**
   * 接收消息
   * @param message 消息
   * @returns 接收结果
   */
  receiveMessage(message: SubAgentMessage): Promise<boolean>;

  /**
   * 获取子代理状态
   * @returns 子代理状态
   */
  getStatus(): SubAgentStatus;

  /**
   * 更新子代理配置
   * @param config 配置
   * @returns 更新结果
   */
  updateConfig(config: Partial<SubAgentConfig>): Promise<boolean>;

  /**
   * 获取子代理配置
   * @returns 子代理配置
   */
  getConfig(): SubAgentConfig;

  /**
   * 获取子代理内存
   * @param limit 限制数量
   * @param tags 标签过滤
   * @returns 内存条目列表
   */
  getMemory(limit?: number, tags?: string[]): Promise<SubAgentMemory[]>;

  /**
   * 添加子代理内存
   * @param memory 内存条目
   * @returns 添加结果
   */
  addMemory(
    memory: Omit<SubAgentMemory, 'id' | 'subAgentId' | 'createdAt'>
  ): Promise<SubAgentMemory>;

  /**
   * 清除子代理内存
   * @param tags 标签过滤
   * @returns 清除结果
   */
  clearMemory(tags?: string[]): Promise<boolean>;

  /**
   * 获取支持的工具
   * @returns 工具列表
   */
  getSupportedTools(): Tool[];

  /**
   * 注册工具
   * @param tool 工具实例
   * @returns 注册结果
   */
  registerTool(tool: Tool): boolean;

  /**
   * 注销工具
   * @param toolName 工具名称
   * @returns 注销结果
   */
  unregisterTool(toolName: string): boolean;
}

/**
 * 子代理工厂接口
 */
export interface SubAgentFactory {
  /**
   * 创建子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createSubAgent(config: SubAgentConfig): SubAgent;

  /**
   * 创建通用子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createGenericSubAgent(config: Partial<SubAgentConfig>): SubAgent;

  /**
   * 创建代码执行子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createCodeExecutionSubAgent(config: Partial<SubAgentConfig>): SubAgent;

  /**
   * 创建网络搜索子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createWebSearchSubAgent(config: Partial<SubAgentConfig>): SubAgent;

  /**
   * 创建数据分析子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createDataAnalysisSubAgent(config: Partial<SubAgentConfig>): SubAgent;

  /**
   * 创建系统管理子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createSystemManagementSubAgent(config: Partial<SubAgentConfig>): SubAgent;

  /**
   * 创建安全分析子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createSecurityAnalysisSubAgent(config: Partial<SubAgentConfig>): SubAgent;

  /**
   * 创建自然语言处理子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createNLPSubAgent(config: Partial<SubAgentConfig>): SubAgent;

  /**
   * 创建多模态处理子代理
   * @param config 子代理配置
   * @returns 子代理实例
   */
  createMultimodalSubAgent(config: Partial<SubAgentConfig>): SubAgent;
}

/**
 * 子代理管理器接口
 */
export interface SubAgentManager {
  /**
   * 创建子代理
   * @param config 子代理配置
   * @returns 子代理ID
   */
  createSubAgent(config: SubAgentConfig): string;

  /**
   * 获取子代理
   * @param subAgentId 子代理ID
   * @returns 子代理实例
   */
  getSubAgent(subAgentId: string): SubAgent | undefined;

  /**
   * 获取所有子代理
   * @returns 子代理实例列表
   */
  getSubAgents(): SubAgent[];

  /**
   * 获取子代理信息
   * @param subAgentId 子代理ID
   * @returns 子代理信息
   */
  getSubAgentInfo(subAgentId: string): SubAgentInfo | undefined;

  /**
   * 获取所有子代理信息
   * @returns 子代理信息列表
   */
  getSubAgentInfos(): SubAgentInfo[];

  /**
   * 启动子代理
   * @param subAgentId 子代理ID
   * @returns 启动结果
   */
  startSubAgent(subAgentId: string): Promise<boolean>;

  /**
   * 停止子代理
   * @param subAgentId 子代理ID
   * @returns 停止结果
   */
  stopSubAgent(subAgentId: string): Promise<boolean>;

  /**
   * 暂停子代理
   * @param subAgentId 子代理ID
   * @returns 暂停结果
   */
  pauseSubAgent(subAgentId: string): Promise<boolean>;

  /**
   * 恢复子代理
   * @param subAgentId 子代理ID
   * @returns 恢复结果
   */
  resumeSubAgent(subAgentId: string): Promise<boolean>;

  /**
   * 执行子代理任务
   * @param request 执行请求
   * @returns 执行响应
   */
  executeSubAgent(
    request: SubAgentExecutionRequest
  ): Promise<SubAgentExecutionResponse>;

  /**
   * 发送消息给子代理
   * @param message 消息
   * @returns 发送结果
   */
  sendMessage(message: SubAgentMessage): Promise<boolean>;

  /**
   * 删除子代理
   * @param subAgentId 子代理ID
   * @returns 删除结果
   */
  deleteSubAgent(subAgentId: string): Promise<boolean>;

  /**
   * 清除所有子代理
   * @returns 清除结果
   */
  clearSubAgents(): Promise<boolean>;

  /**
   * 获取子代理统计信息
   * @returns 统计信息
   */
  getStats(): {
    totalSubAgents: number;
    runningSubAgents: number;
    pausedSubAgents: number;
    errorSubAgents: number;
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
  };
}

/**
 * 创建子代理配置
 * @param config 配置参数
 * @returns 子代理配置
 */
export function createSubAgentConfig(
  config: Partial<SubAgentConfig>
): SubAgentConfig {
  return {
    name: config.name || `sub_agent_${Date.now()}`,
    type: config.type || SubAgentType.GENERIC,
    description: config.description || 'Generic sub agent',
    version: config.version || '1.0.0',
    maxExecutionTime: config.maxExecutionTime || 300000, // 5分钟
    maxConcurrency: config.maxConcurrency || 1,
    memoryLimit: config.memoryLimit || 512,
    toolConfig: config.toolConfig || {},
    securityConfig: {
      sandboxEnabled: true,
      networkAccess: true,
      filesystemAccess: false,
      environmentAccess: false,
      ...config.securityConfig,
    },
    customConfig: config.customConfig || {},
  };
}

/**
 * 创建子代理执行请求
 * @param params 请求参数
 * @returns 子代理执行请求
 */
export function createSubAgentExecutionRequest(
  params: Partial<SubAgentExecutionRequest>
): SubAgentExecutionRequest {
  return {
    id:
      params.id ||
      `request_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    subAgentId: params.subAgentId!,
    task: params.task!,
    input: params.input || {},
    context: params.context,
    timeout: params.timeout || 300000, // 5分钟
    options: {
      enableTools: true,
      enableMemory: true,
      enableLearning: false,
      ...params.options,
    },
  };
}
