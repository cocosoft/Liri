/**
 * 子代理基类
 * 实现子代理接口的通用功能
 */

import {
  SubAgent,
  SubAgentConfig,
  SubAgentInfo,
  SubAgentStatus,
  SubAgentExecutionRequest,
  SubAgentExecutionResponse,
  SubAgentMessage,
  SubAgentMemory,
} from './types/SubAgentTypes';
import { Tool } from '../tools/types/Tool';
import { ToolRegistry, createToolRegistry } from '../tools/ToolRegistry';
import { v4 as uuidv4 } from 'uuid';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ module: 'subagents:base', level: LogLevel.INFO });

/**
 * 子代理基类
 */
export abstract class BaseSubAgent implements SubAgent {
  /** 子代理ID */
  private id: string;
  /** 子代理配置 */
  private config: SubAgentConfig;
  /** 子代理状态 */
  private status: SubAgentStatus;
  /** 工具注册表 */
  private toolRegistry: ToolRegistry;
  /** 子代理内存 */
  private memory: SubAgentMemory[] = [];
  /** 启动时间 */
  private startTime: Date | undefined;
  /** 最后活动时间 */
  private lastActivityTime: Date | undefined;
  /** 执行统计 */
  private stats: {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: number;
  } = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    averageExecutionTime: 0,
  };

  /**
   * 构造函数
   * @param config 子代理配置
   */
  constructor(config: SubAgentConfig) {
    this.id = uuidv4();
    this.config = config;
    this.status = SubAgentStatus.INITIALIZING;
    this.toolRegistry = createToolRegistry();
  }

  /**
   * 获取子代理信息
   * @returns 子代理信息
   */
  getInfo(): SubAgentInfo {
    return {
      id: this.id,
      name: this.config.name,
      type: this.config.type,
      description: this.config.description,
      version: this.config.version,
      status: this.status,
      startTime: this.startTime,
      lastActivityTime: this.lastActivityTime,
      stats: this.stats,
      config: this.config,
    };
  }

  /**
   * 启动子代理
   * @returns 启动结果
   */
  async start(): Promise<boolean> {
    try {
      this.status = SubAgentStatus.READY;
      this.startTime = new Date();
      this.lastActivityTime = new Date();
      await this.onStart();
      return true;
    } catch (error) {
      logger.error(`Error starting sub-agent ${this.id}:`, { error });
      this.status = SubAgentStatus.ERROR;
      return false;
    }
  }

  /**
   * 停止子代理
   * @returns 停止结果
   */
  async stop(): Promise<boolean> {
    try {
      await this.onStop();
      this.status = SubAgentStatus.STOPPED;
      this.lastActivityTime = new Date();
      return true;
    } catch (error) {
      logger.error(`Error stopping sub-agent ${this.id}:`, { error });
      return false;
    }
  }

  /**
   * 暂停子代理
   * @returns 暂停结果
   */
  async pause(): Promise<boolean> {
    try {
      await this.onPause();
      this.status = SubAgentStatus.PAUSED;
      this.lastActivityTime = new Date();
      return true;
    } catch (error) {
      logger.error(`Error pausing sub-agent ${this.id}:`, { error });
      return false;
    }
  }

  /**
   * 恢复子代理
   * @returns 恢复结果
   */
  async resume(): Promise<boolean> {
    try {
      await this.onResume();
      this.status = SubAgentStatus.READY;
      this.lastActivityTime = new Date();
      return true;
    } catch (error) {
      logger.error(`Error resuming sub-agent ${this.id}:`, { error });
      return false;
    }
  }

  /**
   * 执行任务
   * @param request 执行请求
   * @returns 执行响应
   */
  async execute(
    request: SubAgentExecutionRequest
  ): Promise<SubAgentExecutionResponse> {
    const startTime = Date.now();
    this.status = SubAgentStatus.RUNNING;
    this.lastActivityTime = new Date();

    try {
      // 记录任务到内存
      await this.addMemory({
        type: 'task',
        content: request,
        priority: 10,
        tags: ['task', 'execution'],
      });

      // 执行具体任务
      const result = await this.onExecute(request);

      // 更新统计信息
      this.stats.totalExecutions++;
      this.stats.successfulExecutions++;
      this.stats.averageExecutionTime =
        (this.stats.averageExecutionTime * (this.stats.totalExecutions - 1) +
          (Date.now() - startTime)) /
        this.stats.totalExecutions;

      // 记录结果到内存
      await this.addMemory({
        type: 'result',
        content: result,
        priority: 5,
        tags: ['result', 'execution'],
      });

      this.status = SubAgentStatus.READY;
      return {
        id: uuidv4(),
        requestId: request.id,
        subAgentId: this.id,
        result: result.result,
        status: 'success',
        executionTime: Date.now() - startTime,
        toolUsages: result.toolUsages,
        metadata: result.metadata,
      };
    } catch (error: any) {
      // 更新统计信息
      this.stats.totalExecutions++;
      this.stats.failedExecutions++;

      // 记录错误到内存
      await this.addMemory({
        type: 'task',
        content: {
          ...request,
          error: error.message,
        },
        priority: 10,
        tags: ['task', 'execution', 'error'],
      });

      this.status = SubAgentStatus.READY;
      return {
        id: uuidv4(),
        requestId: request.id,
        subAgentId: this.id,
        result: null,
        status: 'failure',
        error: error.message,
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * 发送消息
   * @param message 消息
   * @returns 发送结果
   */
  async sendMessage(message: SubAgentMessage): Promise<boolean> {
    try {
      this.lastActivityTime = new Date();
      return await this.onSendMessage(message);
    } catch (error) {
      logger.error(`Error sending message from sub-agent ${this.id}:`, {
        error,
      });
      return false;
    }
  }

  /**
   * 接收消息
   * @param message 消息
   * @returns 接收结果
   */
  async receiveMessage(message: SubAgentMessage): Promise<boolean> {
    try {
      this.lastActivityTime = new Date();
      return await this.onReceiveMessage(message);
    } catch (error) {
      logger.error(`Error receiving message in sub-agent ${this.id}:`, {
        error,
      });
      return false;
    }
  }

  /**
   * 获取子代理状态
   * @returns 子代理状态
   */
  getStatus(): SubAgentStatus {
    return this.status;
  }

  /**
   * 更新子代理配置
   * @param config 配置
   * @returns 更新结果
   */
  async updateConfig(config: Partial<SubAgentConfig>): Promise<boolean> {
    try {
      this.config = {
        ...this.config,
        ...config,
      };
      this.lastActivityTime = new Date();
      await this.onConfigUpdate(config);
      return true;
    } catch (error) {
      logger.error(`Error updating config for sub-agent ${this.id}:`, {
        error,
      });
      return false;
    }
  }

  /**
   * 获取子代理配置
   * @returns 子代理配置
   */
  getConfig(): SubAgentConfig {
    return this.config;
  }

  /**
   * 获取子代理内存
   * @param limit 限制数量
   * @param tags 标签过滤
   * @returns 内存条目列表
   */
  async getMemory(
    limit: number = 100,
    tags: string[] = []
  ): Promise<SubAgentMemory[]> {
    let filteredMemory = this.memory;

    if (tags.length > 0) {
      filteredMemory = filteredMemory.filter((item) =>
        item.tags?.some((tag: string) => tags.includes(tag))
      );
    }

    return filteredMemory
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  /**
   * 添加子代理内存
   * @param memory 内存条目
   * @returns 添加结果
   */
  async addMemory(
    memory: Omit<SubAgentMemory, 'id' | 'subAgentId' | 'createdAt'>
  ): Promise<SubAgentMemory> {
    const newMemory: SubAgentMemory = {
      id: uuidv4(),
      subAgentId: this.id,
      ...memory,
      createdAt: new Date(),
    };

    this.memory.push(newMemory);

    // 清理过期内存
    this.cleanupExpiredMemory();

    // 限制内存大小
    if (this.memory.length > 1000) {
      this.memory = this.memory
        .sort((a, b) => b.priority || 0 - (a.priority || 0))
        .slice(0, 1000);
    }

    return newMemory;
  }

  /**
   * 清除子代理内存
   * @param tags 标签过滤
   * @returns 清除结果
   */
  async clearMemory(tags: string[] = []): Promise<boolean> {
    try {
      if (tags.length > 0) {
        this.memory = this.memory.filter(
          (item) => !item.tags?.some((tag: string) => tags.includes(tag))
        );
      } else {
        this.memory = [];
      }
      return true;
    } catch (error) {
      logger.error(`Error clearing memory for sub-agent ${this.id}:`, {
        error,
      });
      return false;
    }
  }

  /**
   * 获取支持的工具
   * @returns 工具列表
   */
  getSupportedTools(): Tool[] {
    return Array.from(this.toolRegistry.getTools().values());
  }

  /**
   * 注册工具
   * @param tool 工具实例
   * @returns 注册结果
   */
  registerTool(tool: Tool): boolean {
    try {
      this.toolRegistry.registerTool(tool);
      return true;
    } catch (error) {
      logger.error(
        `Error registering tool ${tool.name} for sub-agent ${this.id}:`,
        { error }
      );
      return false;
    }
  }

  /**
   * 注销工具
   * @param toolName 工具名称
   * @returns 注销结果
   */
  unregisterTool(toolName: string): boolean {
    try {
      this.toolRegistry.removeTool(toolName);
      return true;
    } catch (error) {
      logger.error(
        `Error unregistering tool ${toolName} for sub-agent ${this.id}:`,
        { error }
      );
      return false;
    }
  }

  /**
   * 获取子代理ID
   * @returns 子代理ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * 清理过期内存
   */
  private cleanupExpiredMemory(): void {
    const now = new Date();
    this.memory = this.memory.filter((item) => {
      if (!item.expiresAt) return true;
      return item.expiresAt > now;
    });
  }

  /**
   * 启动时的回调方法
   */
  protected abstract onStart(): Promise<void>;

  /**
   * 停止时的回调方法
   */
  protected abstract onStop(): Promise<void>;

  /**
   * 暂停时的回调方法
   */
  protected abstract onPause(): Promise<void>;

  /**
   * 恢复时的回调方法
   */
  protected abstract onResume(): Promise<void>;

  /**
   * 执行任务时的回调方法
   * @param request 执行请求
   * @returns 执行结果
   */
  protected abstract onExecute(request: SubAgentExecutionRequest): Promise<{
    result: unknown;
    toolUsages?: Array<{
      toolName: string;
      input: Record<string, unknown>;
      output: unknown;
      executionTime: number;
    }>;
    metadata?: Record<string, unknown>;
  }>;

  /**
   * 发送消息时的回调方法
   * @param message 消息
   * @returns 发送结果
   */
  protected abstract onSendMessage(message: SubAgentMessage): Promise<boolean>;

  /**
   * 接收消息时的回调方法
   * @param message 消息
   * @returns 接收结果
   */
  protected abstract onReceiveMessage(
    message: SubAgentMessage
  ): Promise<boolean>;

  /**
   * 配置更新时的回调方法
   * @param config 配置
   */
  protected abstract onConfigUpdate(
    config: Partial<SubAgentConfig>
  ): Promise<void>;
}

/**
 * 通用子代理实现
 */
export class GenericSubAgent extends BaseSubAgent {
  /**
   * 启动时的回调方法
   */
  protected async onStart(): Promise<void> {
    logger.info(`Generic sub-agent ${this.getId()} started`);
  }

  /**
   * 停止时的回调方法
   */
  protected async onStop(): Promise<void> {
    logger.info(`Generic sub-agent ${this.getId()} stopped`);
  }

  /**
   * 暂停时的回调方法
   */
  protected async onPause(): Promise<void> {
    logger.info(`Generic sub-agent ${this.getId()} paused`);
  }

  /**
   * 恢复时的回调方法
   */
  protected async onResume(): Promise<void> {
    logger.info(`Generic sub-agent ${this.getId()} resumed`);
  }

  /**
   * 执行任务时的回调方法
   * @param request 执行请求
   * @returns 执行结果
   */
  protected async onExecute(request: SubAgentExecutionRequest): Promise<{
    result: unknown;
    toolUsages?: Array<{
      toolName: string;
      input: Record<string, unknown>;
      output: unknown;
      executionTime: number;
    }>;
    metadata?: Record<string, unknown>;
  }> {
    logger.info(
      `Generic sub-agent ${this.getId()} executing task: ${request.task}`
    );

    // 简单的任务执行逻辑
    return {
      result: {
        message: `Task executed by generic sub-agent: ${request.task}`,
        input: request.input,
      },
      metadata: {
        subAgentType: 'generic',
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * 发送消息时的回调方法
   * @param message 消息
   * @returns 发送结果
   */
  protected async onSendMessage(message: SubAgentMessage): Promise<boolean> {
    logger.info(`Generic sub-agent ${this.getId()} sending message:`, {
      message,
    });
    return true;
  }

  /**
   * 接收消息时的回调方法
   * @param message 消息
   * @returns 接收结果
   */
  protected async onReceiveMessage(message: SubAgentMessage): Promise<boolean> {
    logger.info(`Generic sub-agent ${this.getId()} received message:`, {
      message,
    });
    return true;
  }

  /**
   * 配置更新时的回调方法
   * @param config 配置
   */
  protected async onConfigUpdate(
    config: Partial<SubAgentConfig>
  ): Promise<void> {
    logger.info(`Generic sub-agent ${this.getId()} config updated:`, {
      config,
    });
  }
}
